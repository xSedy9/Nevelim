//! AI provider clients: Gemini, OpenAI and OpenRouter (OpenAI-compatible).
//!
//! Payload building and response parsing are separated from the HTTP layer
//! so they can be unit tested without a network.

use serde::{Deserialize, Serialize};

use crate::config::{Config, Provider};
use crate::error::{CoreError, CoreResult};

/// Default request timeout in seconds.
pub const REQUEST_TIMEOUT_SECS: u64 = 90;

/// Maximum specification size (in bytes) sent as context.
pub const MAX_SPEC_BYTES: usize = 7500;

/// A single chat message exchanged with an AI provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    /// One of `"system"`, `"user"`, `"assistant"`.
    pub role: String,
    /// Message text.
    pub content: String,
}

impl ChatMessage {
    /// Creates a new chat message.
    pub fn new(role: &str, content: impl Into<String>) -> Self {
        Self {
            role: role.to_string(),
            content: content.into(),
        }
    }
}

/// Truncates specification content to the allowed context budget.
pub fn clamp_spec(spec: &str) -> String {
    let mut bound = spec.len().min(MAX_SPEC_BYTES);
    while bound > 0 && !spec.is_char_boundary(bound) {
        bound -= 1;
    }
    spec[..bound].to_string()
}

/// Builds the Gemini `generateContent` JSON payload.
///
/// System messages are folded into `systemInstruction`; roles are mapped
/// (`assistant` -> `model`).
pub fn build_gemini_payload(messages: &[ChatMessage]) -> serde_json::Value {
    let system: Vec<&str> = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect();
    let contents: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            serde_json::json!({
                "role": if m.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": m.content }],
            })
        })
        .collect();
    let mut payload = serde_json::json!({ "contents": contents });
    if !system.is_empty() {
        payload["systemInstruction"] =
            serde_json::json!({ "parts": [{ "text": system.join("\n\n") }] });
    }
    payload
}

/// Builds an OpenAI-compatible `chat/completions` JSON payload.
pub fn build_openai_payload(messages: &[ChatMessage], model: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.7,
    })
}

/// Extracts the assistant text from a Gemini response body.
pub fn parse_gemini_response(body: &serde_json::Value) -> CoreResult<String> {
    let text = body["candidates"][0]["content"]["parts"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p["text"].as_str())
                .collect::<String>()
        })
        .unwrap_or_default();
    if text.trim().is_empty() {
        Err(CoreError::Other("Gemini вернул пустой ответ".into()))
    } else {
        Ok(text.trim().to_string())
    }
}

/// Extracts the assistant text from an OpenAI-compatible response body.
pub fn parse_openai_response(body: &serde_json::Value) -> CoreResult<String> {
    let text = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default();
    if text.trim().is_empty() {
        Err(CoreError::Other("Провайдер вернул пустой ответ".into()))
    } else {
        Ok(text.trim().to_string())
    }
}

/// Validates that the required API key for `provider` is present.
fn require_key(config: &Config, provider: Provider) -> CoreResult<String> {
    let key = match provider {
        Provider::Gemini => config.gemini_api_key.clone(),
        Provider::OpenAi => config.openai_api_key.clone(),
        Provider::OpenRouter => config.openrouter_api_key.clone(),
    };
    if key.trim().is_empty() {
        Err(CoreError::Other(format!(
            "Не задан API-ключ провайдера {provider:?} в config.json"
        )))
    } else {
        // Trim stray whitespace/newlines/quotes so dirty config edits do not
        // turn into provider 401s.
        Ok(key.trim().to_string())
    }
}

/// A fully prepared provider request: URL, JSON body and the response parser.
type PreparedRequest = (
    String,
    serde_json::Value,
    fn(&serde_json::Value) -> CoreResult<String>,
);

/// Performs a chat completion against the provider configured in `config`.
///
/// Network failures, provider errors and empty answers surface as
/// [`CoreError`] with user-facing Russian messages (same wording as the
/// legacy modal).
pub async fn call_llm_chat(config: &Config, messages: &[ChatMessage]) -> CoreResult<String> {
    let provider = config.provider;
    let key = require_key(config, provider)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()?;

    let (url, body, parse): PreparedRequest = match provider {
            Provider::Gemini => (
                format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={key}",
                    config.gemini_model
                ),
                build_gemini_payload(messages),
                parse_gemini_response,
            ),
            Provider::OpenAi => (
                format!("{}/chat/completions", config.openai_api_base.trim_end_matches('/')),
                build_openai_payload(messages, &config.openai_model),
                parse_openai_response,
            ),
            Provider::OpenRouter => (
                "https://openrouter.ai/api/v1/chat/completions".to_string(),
                build_openai_payload(messages, &config.openrouter_model),
                parse_openai_response,
            ),
        };

    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {key}"))
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let hint = if text.to_lowercase().contains("api key")
            || text.to_lowercase().contains("unauthorized")
        {
            "Проверьте API-ключ в config.json или доступность провайдера."
        } else {
            "Ошибка провайдера, попробуйте позже."
        };
        return Err(CoreError::Other(format!("{status}: {hint}")));
    }

    let body: serde_json::Value = resp.json().await?;
    parse(&body)
}

/// Builds the initial adaptation prompt (system + user messages).
pub fn build_adaptation_messages(spec_content: &str, template_content: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage::new(
            "system",
            "Ты — тимлид и системный архитектор. Адаптируй переданный шаблон под специфику \
             проекта на основе спецификации. Сохраняй стиль автора. Верни ТОЛЬКО готовый результат.",
        ),
        ChatMessage::new(
            "user",
            format!(
                "СПЕЦИФИКАЦИЯ:\n{}\n\nШАБЛОН ДЛЯ АДАПТАЦИИ:\n{}",
                clamp_spec(spec_content),
                template_content
            ),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_spec_respects_budget_and_char_boundaries() {
        let ascii = "a".repeat(MAX_SPEC_BYTES + 100);
        assert_eq!(clamp_spec(&ascii).len(), MAX_SPEC_BYTES);
        // Multibyte string must not be cut inside a character.
        let uni = "ж".repeat(5000);
        let clamped = clamp_spec(&uni);
        assert!(clamped.len() <= MAX_SPEC_BYTES);
        assert_eq!(clamped.chars().count(), MAX_SPEC_BYTES / 2);
    }

    #[test]
    fn gemini_payload_splits_system_and_maps_roles() {
        let msgs = vec![
            ChatMessage::new("system", "be brief"),
            ChatMessage::new("user", "hi"),
            ChatMessage::new("assistant", "hello"),
        ];
        let payload = build_gemini_payload(&msgs);
        assert_eq!(payload["contents"].as_array().unwrap().len(), 2);
        assert_eq!(payload["contents"][0]["role"], "user");
        assert_eq!(payload["contents"][1]["role"], "model");
        assert_eq!(payload["systemInstruction"]["parts"][0]["text"], "be brief");
    }

    #[test]
    fn openai_payload_keeps_all_messages() {
        let msgs = vec![
            ChatMessage::new("system", "s"),
            ChatMessage::new("user", "u"),
        ];
        let payload = build_openai_payload(&msgs, "gpt-x");
        assert_eq!(payload["model"], "gpt-x");
        assert_eq!(payload["messages"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn response_parsers() {
        let gemini = serde_json::json!({
            "candidates": [{ "content": { "parts": [{ "text": " result " }] } }]
        });
        assert_eq!(parse_gemini_response(&gemini).unwrap(), "result");

        let openai = serde_json::json!({
            "choices": [{ "message": { "content": " answer " } }]
        });
        assert_eq!(parse_openai_response(&openai).unwrap(), "answer");

        assert!(parse_gemini_response(&serde_json::json!({})).is_err());
        assert!(parse_openai_response(&serde_json::json!({})).is_err());
    }

    #[test]
    fn missing_key_is_rejected_before_network() {
        let mut cfg = Config::default();
        cfg.provider = Provider::OpenRouter;
        let msgs = vec![ChatMessage::new("user", "x")];
        let result = call_llm_chat(&cfg, &msgs);
        // The key check happens before any network activity; assert via a minimal runtime.
        let err = tokio::runtime::Runtime::new().unwrap().block_on(result);
        assert!(err.unwrap_err().to_string().contains("API-ключ"));
    }

    #[test]
    fn adaptation_messages_shape() {
        let msgs = build_adaptation_messages("spec", "template");
        assert_eq!(msgs[0].role, "system");
        assert!(msgs[1].content.contains("СПЕЦИФИКАЦИЯ"));
        assert!(msgs[1].content.contains("ШАБЛОН"));
    }
}
