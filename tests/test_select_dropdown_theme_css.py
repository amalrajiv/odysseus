from pathlib import Path


STYLE_CSS = Path(__file__).resolve().parents[1] / "static" / "style.css"


def _style_text() -> str:
    return STYLE_CSS.read_text(encoding="utf-8")


def test_native_select_options_use_theme_tokens():
    css = _style_text()

    assert "--select-option-bg:" in css
    assert "--select-option-fg:" in css
    assert "--select-option-active-bg:" in css
    assert "select option,\n    select optgroup" in css
    assert "background-color: var(--select-option-bg);" in css
    assert "color: var(--select-option-fg);" in css
    assert "select option:checked" in css
    assert "background-color: var(--select-option-active-bg);" in css


def test_native_selects_follow_theme_tokens_so_they_stay_readable_on_light():
    """Native <select> boxes stay readable on light themes.

    The old hardcoded ``:root.light { --select-bg: #eaeaea; ... }`` palette was
    intentionally removed (theme.js never adds a ``.light`` class — light themes
    ship as inline theme vars / selectable presets; see the NOTE in style.css).
    Readability is now guaranteed structurally: the select box drives its
    background/foreground from ``--select-bg`` / ``--select-fg``, which resolve
    to the active theme's ``--bg`` / ``--fg`` — so a light theme yields a light
    select rather than a hardcoded dark one.
    """
    css = _style_text()

    # Tokens follow the active theme (light theme => light --bg/--fg => light select).
    assert "--select-bg: var(--bg);" in css
    assert "--select-fg: var(--fg);" in css

    # The select rule consumes those tokens instead of hardcoding colors.
    assert "background-color: var(--select-bg);" in css
    assert "color: var(--select-fg);" in css
