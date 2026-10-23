// Prebuilds the `main` entry point of the desktop shell.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quick_snippets_desktop::run()
}
