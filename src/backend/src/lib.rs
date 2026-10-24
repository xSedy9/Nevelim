//! Nevelim core business logic.
//!
//! This crate is intentionally free of any Tauri/UI dependency so it can be
//! tested in isolation. It hosts configuration management, template scanning,
//! specification discovery, AI provider clients, history storage and the
//! platform-abstraction layer for paste injection.

pub mod ai;
pub mod config;
pub mod error;
pub mod export;
pub mod history;
pub mod hotkey;
pub mod paste;
pub mod spec;
pub mod templates;
