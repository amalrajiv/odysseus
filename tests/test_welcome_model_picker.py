"""Regression guard — model picker must stay visible on the welcome / new-chat screen.

Two failure modes this guards:
1. showWelcomeScreen() must call updateModelPicker() so inline display:none left
   over from group/compare mode is cleared when starting a fresh chat.
2. welcome-active CSS must cap the input-bar lift so the picker row is not
   clipped by .chat-container overflow on short viewports.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHAT_RENDERER = ROOT / "static/js/chatRenderer.js"
STYLE = ROOT / "static/style.css"


def _show_welcome_body() -> str:
    text = CHAT_RENDERER.read_text(encoding="utf-8")
    start = text.index("export function showWelcomeScreen()")
    rest = text[start + len("export function showWelcomeScreen()") :]
    m = re.search(r"\nexport function |\nfunction ", rest)
    return rest[: m.start()] if m else rest


def test_welcome_screen_refreshes_model_picker():
    body = _show_welcome_body()
    assert "updateModelPicker" in body, "showWelcomeScreen must refresh the composer model picker"


def test_welcome_active_input_lift_is_capped():
    css = STYLE.read_text(encoding="utf-8")
    block = re.search(
        r"\.chat-container\.welcome-active \.chat-input-bar\s*\{[^}]+\}",
        css,
        re.DOTALL,
    )
    assert block, "welcome-active input-bar rule missing"
    rule = block.group(0)
    assert "margin-bottom" in rule
    assert "min(" in rule, "welcome lift must be capped (min()) so the picker is not clipped"
    assert "100dvh" in rule or "100vh" in rule, "cap should reference viewport height"
