//! Unified error type for the core crate.

use thiserror::Error;

/// Error type returned by all fallible core operations.
#[derive(Debug, Error)]
pub enum CoreError {
    /// Filesystem error.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON (de)serialization error.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    /// HTTP error while talking to an AI provider.
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    /// Input injection error.
    #[error("input error: {0}")]
    Input(String),

    /// Any other error with a human-readable message.
    #[error("{0}")]
    Other(String),
}

/// Convenience result alias used across the crate.
pub type CoreResult<T> = Result<T, CoreError>;
