# Odysseus — Project Architecture Guide

> A self-hosted AI workspace: chat, agents, research, documents, email, notes, calendar, model serving (Cookbook), and more.  
> Stack: **Python 3 / FastAPI / SQLAlchemy / SQLite / ChromaDB / vanilla ES modules (no build step)**.

---

## Table of Contents

1. [Folder Structure](#1-folder-structure)
2. [Backend Architecture](#2-backend-architecture)
3. [Frontend Architecture](#3-frontend-architecture)
4. [Request Lifecycle](#4-request-lifecycle)
5. [Authentication Flow](#5-authentication-flow)
6. [Database Schema](#6-database-schema)
7. [LLM Abstraction Layer](#7-llm-abstraction-layer)
8. [Search / RAG Pipeline](#8-search--rag-pipeline)
9. [Configuration System](#9-configuration-system)
10. [Extension Points](#10-extension-points)

---

## 1. Folder Structure

```
odysseus/
├── app.py                    # FastAPI orchestrator: middleware, auth, router mounting, SPA routes, lifespan
├── launcher.py               # Windows portable entry (tkinter splash, system tray, uvicorn)
├── pyproject.toml            # pytest config + test taxonomy markers
├── requirements.txt          # Core Python deps (FastAPI, SQLAlchemy, chromadb-client, fastembed, mcp, …)
├── requirements-optional.txt # Optional extras
├── docker-compose.yml        # odysseus + searxng + chromadb + ntfy services
├── docker/                   # GPU overlay compose fragments (nvidia.yml, amd.yml)
├── .env.example              # Environment variable reference
├── Odysseus.spec             # PyInstaller spec for Windows bundle
│
├── core/                     # Foundational backend layer
│   ├── auth.py               # Multi-user bcrypt auth, sessions, TOTP 2FA, privileges
│   ├── database.py           # SQLAlchemy models, migrations, init_db()
│   ├── models.py             # Pure dataclasses (Session, ChatMessage) — in-memory chat state
│   ├── session_manager.py    # Session persistence (JSON + DB bridge)
│   ├── middleware.py         # Security headers, CSP nonce, require_admin, internal-tool token
│   ├── constants.py          # App-wide constants (paths, timeouts)
│   ├── atomic_io.py          # Atomic JSON/text writes
│   ├── exceptions.py         # Domain exceptions (SessionNotFoundError, LLMServiceError, …)
│   └── platform_compat.py    # OS helpers (Windows/Unix)
│
├── routes/                   # FastAPI routers (~58 modules) — thin HTTP handlers
│   ├── auth_routes.py        # /api/auth/*
│   ├── chat_routes.py        # /api/chat, /api/chat_stream (primary chat path)
│   ├── session_routes.py     # Session CRUD
│   ├── memory_routes.py      # Memory CRUD + vector search
│   ├── research/             # Deep research background jobs
│   ├── gallery/              # Image library routes
│   ├── email_routes.py       # IMAP/SMTP email feature
│   ├── calendar_routes.py    # CalDAV calendar
│   ├── cookbook_routes.py    # Model download/serve/cache
│   ├── mcp_routes.py         # MCP server management
│   └── … (model, upload, task, webhook, compare, vault, contacts, …)
│
├── services/                 # Domain service layer (~38 modules)
│   ├── search/               # Web search orchestration (SearXNG, Brave, DDG, ranking, cache)
│   ├── research/             # Deep research pipeline
│   ├── memory/               # Skills, memory extraction, vector helpers
│   ├── hwfit/                # Hardware model fitting ("What Fits?")
│   ├── tts/, stt/            # Speech services
│   ├── shell/                # Shell execution service
│   ├── youtube/              # YouTube transcript/comments
│   └── docs/                 # Document service helpers
│
├── src/                      # Business logic (~200+ modules)
│   ├── llm_core.py           # LLM HTTP client: provider detection, streaming, retries
│   ├── agent_loop.py         # Multi-round agent tool loop
│   ├── agent_tools/          # Tool registry, parsing, execution, domain tools
│   ├── tools/                # Tool implementations split by domain
│   ├── chat_processor.py     # Context building: RAG, memory, web search preface
│   ├── chat_handler.py       # Chat orchestration
│   ├── config.py             # Pydantic settings (DataConfig, LLMConfig, SearchConfig, …)
│   ├── settings.py           # data/settings.json + data/features.json
│   ├── rag_vector.py         # ChromaDB vector RAG + hybrid search
│   ├── rag_manager.py        # Thin RAG wrapper
│   ├── embedding_lanes.py    # Multi-lane embedding (fastembed vs custom HTTP)
│   ├── embeddings.py         # HTTP + FastEmbed embedding clients
│   ├── memory_provider.py    # Pluggable memory provider interface
│   ├── mcp_manager.py        # MCP server connections
│   ├── model_discovery.py    # LLM host/model scanning
│   ├── task_scheduler.py     # Scheduled LLM/action tasks
│   ├── webhook_manager.py    # Outgoing webhooks
│   ├── builtin_actions.py    # Non-LLM scheduled actions registry
│   └── …
│
├── static/                   # Frontend SPA (no bundler)
│   ├── index.html            # Monolithic HTML shell + CSP nonce injection
│   ├── login.html            # Login/setup page
│   ├── app.js                # Main orchestrator (imports all modules, wires events)
│   ├── style.css             # Global CSS variables + layout
│   ├── sw.js                 # Service worker (PWA)
│   └── js/                   # ~160 ES modules
│       ├── chat.js, chatStream.js, chatRenderer.js
│       ├── sessions.js, memory.js, skills.js
│       ├── document.js, gallery.js, emailInbox.js
│       ├── cookbook.js, compare/, editor/, research/
│       └── …
│
├── companion/                # Mobile companion pairing API
├── integrations/             # External bridges (e.g. Claude/Codex skills)
├── config/searxng/           # Bundled SearXNG settings
├── scripts/                  # CLI tools (odysseus, odysseus-mail, gallery, …)
├── tests/                    # ~900+ pytest tests (area_* taxonomy)
├── docs/                     # Setup guide, landing page, screenshots
├── .github/workflows/        # CI: tests, container scan, dependency review
└── data/ (runtime)           # SQLite, auth.json, uploads, chroma, settings — NOT in repo
```

**Layering convention:**
- `routes/` — HTTP boundary only (parse request, call service, return response)
- `services/` — reusable domain logic (no HTTP concerns)
- `src/` — application core (LLM, agent, config, RAG)
- `core/` — infrastructure shared across all features (DB, auth, middleware)

---

## 2. Backend Architecture

### Framework & Runtime

- **FastAPI** on **Starlette**, served by **uvicorn** (default port **7000**)
- Entry points:
  - `app.py` — primary (`uvicorn app:app`)
  - `launcher.py` — Windows frozen bundle with GUI splash + system tray
  - `scripts/odysseus` — CLI wrapper

```python
# app.py
app = FastAPI(
    title="AI Chat Application",
    description="Comprehensive AI chat with memory, research, and multi-modal capabilities",
    version="1.0.0",
)
```

### Middleware Chain

FastAPI stacks middleware in **reverse registration order** (last registered = outermost). A request passes through all layers before reaching the route handler:

```
Inbound Request
        │
        ▼
┌───────────────────────────────────────┐
│  AuthMiddleware (if AUTH_ENABLED)     │  Cookie / bearer / internal-token validation
├───────────────────────────────────────┤
│  _RequestTimeoutMiddleware (45s)      │  Exempt: /api/chat, /api/research, …
├───────────────────────────────────────┤
│  SecurityHeadersMiddleware            │  CSP nonce, X-Frame-Options, HSTS
├───────────────────────────────────────┤
│  GZipMiddleware (min 1024 bytes)      │  SSE streams excluded
├───────────────────────────────────────┤
│  CORSMiddleware                       │  Credentials + custom headers
└───────────────────────────────────────┘
        │
        ▼
Route handler / StaticFiles / exception handlers
        │
        ▼
Outbound Response (same stack, reversed)
```

### Router Registration

All routers are mounted in `app.py` via factory functions (`setup_*_routes`):

| Prefix / Area | Module | Purpose |
|---|---|---|
| `/api/auth` | `routes/auth_routes.py` | Login, signup, 2FA, user admin |
| `/api/chat*` | `routes/chat_routes.py` | Streaming chat + agent |
| `/api/sessions` | `routes/session_routes.py` | Chat session management |
| `/api/memory` | `routes/memory_routes.py` | Long-term memory |
| `/api/research` | `routes/research/` | Deep research jobs |
| `/api/personal` | `routes/personal_routes.py` | Personal docs + RAG indexing |
| `/api/model*` | `routes/model_routes.py` | Endpoints, probing, downloads |
| `/api/cookbook` | `routes/cookbook_routes.py` | Model serve lifecycle |
| `/api/email` | `routes/email_routes.py` | IMAP inbox |
| `/api/calendar` | `routes/calendar_routes.py` | CalDAV sync |
| `/api/tasks` | `routes/task_routes.py` | Scheduled tasks + webhooks |
| `/api/mcp` | `routes/mcp_routes.py` | MCP server CRUD |
| `/static` | `StaticFiles` | Frontend assets |

### Service / Manager Initialization

All long-lived singletons are created in `src/app_initializer.py` and injected into route factories:

```python
# src/app_initializer.py (abbreviated)
memory_manager       = MemoryManager(DATA_DIR)
skills_manager       = SkillsManager(DATA_DIR)
session_manager      = SessionManager(SESSIONS_FILE)
upload_handler       = UploadHandler(base_dir, UPLOAD_DIR)
personal_docs_manager = PersonalDocsManager(PERSONAL_DIR, rag_manager)
chat_processor       = ChatProcessor(memory_manager, personal_docs_manager,
                                     memory_vector=memory_vector, ...)
chat_handler         = ChatHandler(session_manager, memory_manager,
                                   chat_processor, ...)
model_discovery      = ModelDiscovery(DEFAULT_HOST, OPENAI_API_KEY)
```

### Key Backend Modules

| Module | Role |
|---|---|
| `src/llm_core.py` | All LLM HTTP I/O: provider adapters, streaming SSE, retries, dead-host cooldown |
| `src/agent_loop.py` | Multi-round tool execution wrapping `stream_llm` |
| `src/chat_processor.py` | Pre-LLM context assembly: memory retrieval, RAG chunks, web search preface |
| `core/database.py` | ORM + 40+ incremental SQLite migrations |
| `core/session_manager.py` | Bridges in-memory `core.models.Session` ↔ SQLite |
| `src/task_scheduler.py` | Cron / event-triggered LLM and action tasks |
| `src/mcp_manager.py` | MCP stdio/SSE server lifecycle and tool dispatch |
| `services/search/core.py` | Multi-provider web search with caching + ranking |

### Application Lifespan (startup / shutdown)

```python
# app.py — lifespan (simplified)
async def _startup_event():
    webhook_manager.set_loop(asyncio.get_running_loop())
    # Purge incognito sessions
    # Start upload cleanup + background job monitor
    # Connect MCP servers (async, non-blocking)
    # Pre-warm RAG tool index
    # Start in-process email pollers + task scheduler (if enabled)

async def _shutdown_event():
    # Cancel background tasks
    # Disconnect MCP servers
    # Cleanup temp resources
```

---

## 3. Frontend Architecture

### Framework & Philosophy

- **No React / Vue / Svelte** — vanilla **ES6 modules**, loaded directly by the browser
- **No build step** — files served from `/static` with `Cache-Control: no-cache` for `.js/.css/.html`
- **Single-page application (SPA)** — all feature routes (`/calendar`, `/email`, `/cookbook`, …) return `index.html`; JS reads `window.location.pathname` to open the relevant panel

### Entry Point & Module Loading

`index.html` loads ~35 module `<script type="module">` tags, with `app.js` last:

```html
<!-- static/index.html -->
<script type="module" src="/static/js/sessions.js"></script>
<script type="module" src="/static/js/chat.js"></script>
<!-- … ~35 module scripts … -->
<script type="module" src="/static/app.js"></script>
<script type="module" src="/static/js/init.js"></script>
```

`app.js` is the orchestrator — it imports all feature modules, wires global event listeners, and patches `window.fetch` to handle 401 redirects:

```javascript
// static/app.js
import chatModule    from './js/chat.js';
import sessionModule from './js/sessions.js';
import memoryModule  from './js/memory.js';
import cookbookModule from './js/cookbook.js';
// … 20+ feature modules

// Global 401 → redirect to /login
window.fetch = async function(...args) {
    const res = await _origFetch.apply(this, args);
    if (res.status === 401 && !String(args[0]).includes('/api/auth/')) {
        window.location.href = '/login';
    }
    return res;
};
```

### State Management

There is no shared state library. State is maintained as:

| Approach | Used for |
|---|---|
| Module-scoped variables | Feature-local state (active message, panel open/close) |
| `window.*Module` globals | Cross-module access (e.g., `window.sessionModule.reload()`) |
| `localStorage` | Theme (`odysseus-theme`), UI scale, density preference |
| Server state via REST/SSE | Sessions, messages, memory — all persisted in SQLite via API |

Key stateful modules:
- `sessions.js` — active session ID, history list
- `chat.js` + `chatStream.js` — streaming SSE consumer and partial message buffer
- `settings.js` / `admin.js` — admin settings panel
- `storage.js` — `localStorage` abstraction

### Routing

- **Server-side** (FastAPI): returns `index.html` for `/`, `/notes`, `/calendar`, `/email`, `/cookbook`, `/memory`, `/gallery`, `/tasks`, `/library`
- **Client-side**: pathname-based modal auto-open on load — no client router library
- **Deep links**: hash anchors (`#session-<id>`, `#document-<id>`, `#email-<uid>`, …) parsed by the chat renderer

### Styling

- **`static/style.css`** — CSS custom properties (`--bg`, `--fg`, `--red`, `--brand-color`, …) as the design token layer
- **Theme system** (`js/theme.js`): persisted color palette applied via `document.documentElement.style.setProperty` at runtime
- **Density and scale**: CSS classes on `<html>` (`density-compact`, `ui-scale-110`, …) driven by settings
- **Sub-feature CSS**: embedded inline or in per-module subdirectories (e.g., `js/editor/`)

### Major Frontend Subsystems

| Directory | Purpose |
|---|---|
| `js/editor/` | Canvas image editor (layers, filters, AI inpaint/rembg) |
| `js/compare/` | Blind A/B model comparison UI |
| `js/research/` | Deep research job submission and result panel |
| `js/emailLibrary/` | Email inbox UI (IMAP fetch + thread view) |
| `js/calendar/` | Calendar grid + reminder management |
| `js/markdown/` | Markdown and table rendering helpers |

---

## 4. Request Lifecycle

### Traced: `POST /api/chat_stream` (primary chat path)

```
Browser — chat.js
  │  FormData: message, session_id, mode, use_rag, use_web,
  │            attachments, model_override, …
  ▼
CORSMiddleware
  ▼
GZipMiddleware
  │  (skipped — response is text/event-stream)
  ▼
SecurityHeadersMiddleware
  │  Generates per-request CSP nonce → request.state.csp_nonce
  ▼
_RequestTimeoutMiddleware
  │  /api/chat → EXEMPT (long-lived SSE connection)
  ▼
AuthMiddleware
  │  1. CORS preflight → pass through immediately
  │  2. Auth-exempt paths (/static, /api/health) → pass
  │  3. X-Odysseus-Internal-Token (trusted loopback, agent tools) → set user
  │  4. LOCALHOST_BYPASS (loopback-only, opt-in) → pass
  │  5. Bearer ody_* API token → bcrypt verify against api_tokens table
  │  6. Cookie odysseus_session → validate session → set current_user
  │  7. None matched → 401 JSON or 302 → /login
  ▼
routes/chat_routes.py :: chat_stream()
  │  Parse FormData / JSON body
  │  Resolve workspace, active email/doc context from session
  │  Auto-escalate chat → agent for tool intents (notes, calendar commands)
  │  _enforce_chat_privileges() — check model allowlists, feature flags
  │
  ├─ build_chat_context()
  │    ├─ Load session history from SQLite
  │    ├─ Retrieve relevant memories (vector search)
  │    ├─ Retrieve RAG chunks (if session.rag=True and feature enabled)
  │    ├─ Fetch web search preface (if use_web=True)
  │    └─ Inject skills, system prompt, active document context
  │
  ├─ mode=chat  ──► stream_llm() / stream_llm_with_fallback()
  │
  └─ mode=agent ──► stream_agent_loop()
         │  Build tool preamble + rules → prepend to messages
         │  stream_llm() with optional native tools schema (function calling)
         │  Parse tool invocations:
         │    • Fenced code blocks (```bash\n…```) — all models
         │    • native tool_calls JSON — OpenAI / Anthropic tool-capable models
         │  execute_tool_block() → TOOL_HANDLERS / MCP tool dispatch
         │  Append tool result → loop (up to MAX_AGENT_ROUNDS = 50)
         ▼
StreamingResponse (text/event-stream)
  │  data: {"delta": "..."}\n\n
  │  data: {"type": "tool_start", "name": "bash"}\n\n
  │  data: {"type": "tool_result", "content": "..."}\n\n
  │  data: [DONE]\n\n
  ▼
Browser — chatStream.js
  │  EventSource reader; renders partial message incrementally
  │  Handles tool UI blocks inline
  │
Post-stream (async fire-and-forget):
  save_assistant_response()  → INSERT into chat_messages (SQLite)
  run_post_response_tasks()  → memory extraction, webhook dispatch,
                               skill learning, title generation
```

### Static Asset Request

```
GET /static/js/chat.js
  → AuthMiddleware: /static prefix → exempt
  → _RevalidatingStatic: Cache-Control: no-cache
  → FileResponse
```

### Health / Readiness

- `GET /api/health` — liveness ping (auth-exempt)
- `GET /api/ready` — readiness check via `src/readiness.py` (DB, data dir integrity)

---

## 5. Authentication Flow

### Supported Mechanisms

| Method | Token / Credential | Storage | Typical use case |
|---|---|---|---|
| Session cookie | `odysseus_session` (64-char hex) | `data/sessions.json` + in-memory | Browser UI |
| Bearer API token | `ody_<base64>` | `api_tokens` table (bcrypt hash) | External integrations (n8n, Codex, …) |
| Internal tool token | `X-Odysseus-Internal-Token` | Per-process random (env or generated) | Agent loopback calls to admin routes |
| TOTP 2FA | TOTP (pyotp) | Per-user in `data/auth.json` | Optional second factor for browser login |

### Browser Login Flow

```
POST /api/auth/login
  { username, password, totp_code? }
         │
         ▼
  RateLimiter (15 req/min per IP)
         │
         ▼
  auth_manager.verify_password()    ← bcrypt compare
         │
         ▼
  auth_manager.totp_verify()        ← only if 2FA enabled for user
         │
         ▼
  auth_manager.create_session_trusted()  → 64-char hex token
         │
         ▼
  Set-Cookie: odysseus_session=<token>
              HttpOnly; SameSite=Lax; Secure (if SECURE_COOKIES=true); Path=/
```

### AuthMiddleware Decision Tree

```python
# core/middleware.py — AuthMiddleware.dispatch (simplified)
if is_cors_preflight:
    pass  # → next()
elif _is_auth_exempt(path):   # /static, /api/health, /login, …
    pass
elif internal_tool_token_valid and is_trusted_loopback:
    request.state.current_user = "internal"
elif LOCALHOST_BYPASS and is_trusted_loopback:
    pass  # trusted local dev shortcut
elif "Authorization: Bearer ody_*" header:
    verify bcrypt(token) against api_tokens table
    request.state.current_user = token.owner
elif cookie "odysseus_session" valid:
    request.state.current_user = session.username
else:
    return 401 JSON  (or 302 → /login for HTML requests)
```

### Multi-User & Privilege Model

- Users stored in `data/auth.json` with bcrypt password hashes and optional TOTP secrets
- Per-user privilege flags: `can_use_agent`, `can_use_bash`, `allowed_models`, `block_all_models`, and more
- Owner scoping: almost every DB table has an `owner` column; queries filter on `request.state.current_user`
- Admin-only routes are guarded by `require_admin` dependency from `core/middleware.py`

### Key Auth Files

| File | Purpose |
|---|---|
| `core/auth.py` | `AuthManager` class — users, sessions, TOTP, password ops |
| `routes/auth_routes.py` | HTTP endpoints: login, logout, signup, 2FA setup |
| `core/middleware.py` | `AuthMiddleware`, `require_admin`, internal token guard |
| `routes/api_token_routes.py` | Bearer API token CRUD |
| `src/auth_helpers.py` | FastAPI deps: `get_current_user`, `owner_filter` |

---

## 6. Database Schema

### ORM: SQLAlchemy + SQLite

- Default URL: `sqlite:///./data/app.db` (override via `DATABASE_URL` env var)
- `init_db()` in `core/database.py` runs at import time: creates all tables then applies incremental migrations
- `PRAGMA foreign_keys = ON` enforced on every connection
- Sensitive columns use `EncryptedText` (Fernet via `src/secret_storage.py`, keyed by `data/.app_key`)

### Table Map & Relationships

```
sessions (1) ──< chat_messages
sessions (1) ──< documents
documents (1) ──< document_versions
sessions (1) ──< user_tools
user_tools (1) ──< user_tool_data
sessions (1) ──< scheduled_tasks
scheduled_tasks ──► scheduled_tasks (then_task_id self-FK for chaining)

Standalone / lookup tables:
  model_endpoints           LLM endpoint registry
  provider_auth_sessions    OAuth sessions for providers
  mcp_servers               MCP server definitions
  api_tokens                Bearer token hashes + scopes
  webhooks                  Outgoing webhook configs
  comparisons               Blind A/B model comparison records
  signatures                Document / message signatures
  gallery_albums            Image album metadata
  gallery_images            Individual image entries
  email_accounts            IMAP/SMTP account configs (encrypted passwords)
  crew_members              Custom AI personas
  editor_drafts             Canvas editor draft state
  task_runs                 Scheduled task execution history
  memories                  Long-term memory entries
  notes                     Markdown notes
  calendar_cals             CalDAV calendar definitions
  calendar_events           Calendar event entries
  calendar_deleted_events   Tombstones for CalDAV sync
  integrations              Custom API call definitions
```

### Core Model Snippets

```python
# core/database.py

class Session(TimestampMixin, Base):
    __tablename__ = "sessions"
    id           = Column(String, primary_key=True)
    name         = Column(String, nullable=False)
    endpoint_url = Column(String, nullable=False)
    model        = Column(String, nullable=False)
    owner        = Column(String, nullable=True, index=True)
    rag          = Column(Boolean, default=False)
    mode         = Column(String, nullable=True)   # 'agent' | 'chat' | 'research'
    messages     = relationship("ChatMessage", back_populates="session",
                                cascade="all, delete-orphan")

class ModelEndpoint(TimestampMixin, Base):
    __tablename__ = "model_endpoints"
    id       = Column(String, primary_key=True)
    base_url = Column(String, nullable=False)
    api_key  = Column(EncryptedText, nullable=True)
    supports_tools = Column(Boolean, nullable=True)
    owner    = Column(String, nullable=True, index=True)

class ApiToken(TimestampMixin, Base):
    __tablename__ = "api_tokens"
    token_hash   = Column(String, nullable=False)
    token_prefix = Column(String, nullable=False)
    scopes       = Column(String, nullable=False, default="chat")
    owner        = Column(String, nullable=True, index=True)
```

### Migration Strategy

No Alembic. Schema evolution is handled by **inline Python migration functions** called from `init_db()`:

```python
def init_db():
    _migrate_model_endpoints()
    Base.metadata.create_all(bind=engine)       # create any missing tables
    _migrate_add_hidden_models_column()
    _migrate_add_owner_column()
    _migrate_encrypt_email_passwords()
    _migrate_chat_messages_fts()                # SQLite FTS5 full-text index
    # … ~35 more _migrate_* calls
```

Each `_migrate_*` function is idempotent (guards with `ALTER TABLE` try/except or column existence checks).

### Additional Databases

| File | Purpose |
|---|---|
| `data/scheduled_emails.db` | Agent-drafted emails pending human approval |
| `data/email_cache.db` | IMAP message body cache |
| `data/sessions.json` | Legacy session metadata (bridged by `SessionManager`) |
| `data/auth.json` | User credentials + TOTP secrets |
| `data/memory.json` | Native memory entries (file-backed, replicated to Chroma) |

### Full-Text Search

A virtual table `chat_messages_fts` (SQLite FTS5) is maintained by database triggers on `chat_messages` INSERT / UPDATE / DELETE, enabling fast keyword search across all session transcripts.

---

## 7. LLM Abstraction Layer

### Design

A single module, `src/llm_core.py`, implements an **OpenAI-compatible HTTP client** with provider-specific adapters activated by URL hostname detection. All LLM calls — streaming and non-streaming, chat and agent — go through this layer.

### Provider Detection

```python
# src/llm_core.py
def _detect_provider(url: str) -> str:
    if _is_ollama_native_url(url):          return "ollama"
    if _host_match(url, "anthropic.com"):   return "anthropic"
    if _host_match(url, "openrouter.ai"):   return "openrouter"
    if _host_match(url, "groq.com"):        return "groq"
    # … mistral, moonshot, nvidia, copilot, chatgpt-subscription, …
    return "openai"   # default: OpenAI-compatible
```

### Core API Functions

| Function | Purpose |
|---|---|
| `llm_call()` | Synchronous non-streaming call (threadpool) |
| `llm_call_async()` | Async non-streaming |
| `llm_call_with_fallback()` | Try multiple endpoint/model candidates |
| `stream_llm()` | Async generator yielding SSE delta chunks |
| `stream_llm_with_fallback()` | Streaming with ordered candidate failover |

### Streaming Internals

```
stream_llm(url, model, messages, tools=None, ...)
    │
    ├─ _detect_provider(url)
    ├─ _sanitize_llm_messages()     ← normalize roles, merge system messages to front
    │
    ├─ provider == "anthropic"
    │    └─ _build_anthropic_payload()  ← Anthropic Messages API format
    ├─ provider == "ollama"
    │    └─ _build_ollama_payload()     ← Ollama native format
    └─ default (openai-compatible)
         └─ standard OpenAI chat completions payload
    │
    └─ httpx AsyncClient.stream()
         │  Parse SSE: data: {...}
         │  Harmony channel router  ← separate thinking vs final output
         └─ yield {"delta": "..."}  ← consumed by agent_loop or chat route
```

### Model Selection

1. **Admin-configured endpoints** — `model_endpoints` table (base URL + optional encrypted API key)
2. **Model discovery** — `src/model_discovery.py` scans configured hosts/ports, Tailscale peers, Ollama and LM Studio env URLs
3. **Session binding** — each chat session stores `endpoint_url` + `model`; overrideable per-message
4. **Fallback chains** — `stream_llm_with_fallback(candidates, messages)` tries an ordered list of `(endpoint_url, model)` pairs
5. **Cookbook** — dynamically downloads and serves local models, auto-registering them as endpoints

### Prompt Management

| Prompt type | Location |
|---|---|
| Agent preamble / rules | Hardcoded in `src/agent_loop.py` (`_AGENT_PREAMBLE`, `_AGENT_RULES`) |
| Chat system prompt | Session field or user-selected preset |
| User presets | `data/presets.json` via `PresetManager` |
| Skills | Markdown documents in `data/skills/` via `SkillsManager`, injected as context |
| Crew member personas | `crew_members` table — per-member system prompt |

### Resilience Features

| Feature | Detail |
|---|---|
| Dead-host cooldown | 20-second backoff after 2 consecutive connect failures to same host |
| Connect timeout | Configurable via `LLM_CONNECT_TIMEOUT` env var (default 10s) |
| Response caching | SHA-256 keyed in-memory cache for identical request payloads |
| Harmony stripping | Removes thinking-model internal reasoning markers from streamed output |
| Dual tool invocation | Fenced code blocks for all models + native `tool_calls` for capable APIs |

---

## 8. Search / RAG Pipeline

### A. Document RAG (Personal Docs)

**Vector store:** ChromaDB (HTTP client to sidecar, or local `data/chroma` dir)

**Embedding lanes** (`src/embedding_lanes.py`):

| Lane | Backend | Default model |
|---|---|---|
| `LANE_FASTEMBED` | Local ONNX via `fastembed` | `sentence-transformers/all-MiniLM-L6-v2` |
| `LANE_CUSTOM` | HTTP OpenAI-compatible `/v1/embeddings` | Configured via `EMBEDDING_URL` / `EMBEDDING_MODEL` |

Each lane writes to its own Chroma collection (different embedding dimensions must not mix).

**Indexing flow:**

```
POST /api/personal/add_directory
        │
        ▼
PersonalDocsManager.scan_files()
  Supports: .txt, .md, .py, .pdf, .docx, …
        │
        ▼
Sentence-aware chunking
  chunk_size=1000, overlap=200 (from AppConfig)
        │
        ▼
VectorRAG.add_documents_batch()
  → embed via active lane
  → ChromaDB insert with owner-scoped doc IDs
```

**Retrieval (hybrid search):**

```python
# src/rag_vector.py
VECTOR_WEIGHT  = 0.7
KEYWORD_WEIGHT = 0.3

def search(self, query, k=5, owner=None):
    # 1. Query all embedding lanes in parallel
    # 2. Compute hybrid_score = 0.7 * vector_similarity + 0.3 * keyword_overlap
    # 3. Sort by hybrid_score, deduplicate, return top-k
    # 4. Fallback: _keyword_search_fallback() if ChromaDB unreachable
```

**Chat integration** (`src/chat_processor.py`):
- Activated when `session.rag = True` and feature flag `rag` is enabled
- Chunks with score above `RAG_SIMILARITY_THRESHOLD = 0.35` are injected
- Injected as an "untrusted context" block with a wrapper prompt reminding the model it may be incomplete

### B. Memory Vector Search

- `src/memory_vector.py` — separate Chroma collection for personal memory entries
- Hybrid BM25-style keyword + vector scoring in `ChatProcessor._hybrid_retrieve()`
- Rebuilt from `data/memory.json` on first startup if the vector collection is empty

### C. Web Search (live retrieval, not vector)

```
comprehensive_web_search(query)
        │
        ├─ Check disk cache (services/search/cache.py)
        │
        ├─ Provider chain: primary → fallbacks
        │    Supported: searxng, brave, duckduckgo, google_pse, tavily, serper
        │
        ├─ rank_search_results()
        │    Scores: title relevance, snippet quality, domain authority
        │    (.edu/.gov = 1.0), news recency, trusted domain boosts
        │
        ├─ fetch_webpage_content()
        │    Parallel page fetch via ThreadPoolExecutor
        │
        └─ Return (context_string, sources[])
```

Domain ranking heuristics (`services/search/ranking.py`):
- Authoritative domains (`.edu`, `.gov`) get a base score of 1.0
- News queries: trusted outlets boosted ×1.2; sports noise pages penalized −1.5
- Recency: score 1.0 if ≤7 days old, 0.0 if ≥30 days old

### D. Tool Index RAG

- Agent tool selection uses semantic search over tool descriptions (Chroma-backed tool index)
- Index is pre-warmed at startup; used to select relevant tools from the 50+ available based on user intent
- Results filtered by tool policy and per-user disabled-tools list before injection into agent context

### Vector Store Configuration

```bash
CHROMADB_HOST=localhost             # Docker service: chromadb
CHROMADB_PORT=8100
EMBEDDING_URL=http://localhost:11434/v1/embeddings
EMBEDDING_MODEL=all-minilm:l6-v2
FASTEMBED_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

---

## 9. Configuration System

### Environment Variables (`.env.example`)

| Category | Key variables |
|---|---|
| Server | `APP_BIND`, `APP_PORT`, `AUTH_ENABLED`, `LOCALHOST_BYPASS`, `SECURE_COOKIES`, `ALLOWED_ORIGINS` |
| LLM | `LLM_HOST`, `LLM_HOSTS`, `OLLAMA_BASE_URL`, `LM_STUDIO_URL`, `OPENAI_API_KEY`, `LLM_CA_BUNDLE` |
| Database | `DATABASE_URL`, `ODYSSEUS_DATA_DIR` |
| Search | `SEARXNG_INSTANCE`, `SEARXNG_SECRET` |
| Vectors | `CHROMADB_HOST`, `CHROMADB_PORT`, `EMBEDDING_URL`, `EMBEDDING_MODEL`, `FASTEMBED_MODEL` |
| Upload limits | `ODYSSEUS_CHAT_UPLOAD_MAX_BYTES`, `ODYSSEUS_*_MAX_BYTES` (per feature) |
| Workers | `ODYSSEUS_INPROCESS_POLLERS`, `ODYSSEUS_INPROCESS_TASKS` |
| GPU Docker | `COMPOSE_FILE=docker-compose.yml:docker/gpu.nvidia.yml` |

### Pydantic Settings (`src/config.py`)

Strongly-typed, validated at startup:

```python
class AppConfig(BaseSettings):
    data:     DataConfig      # paths, upload limits, chunk sizes
    llm:      LLMConfig       # timeouts, max tokens, temperature defaults
    search:   SearchConfig    # searxng URL, research service settings
    security: SecurityConfig  # rate limits, CORS, dangerous file type list
```

### Runtime JSON Config (under `data/`)

These files are read/written at runtime by the app and survive restarts:

| File | Managed by | Contents |
|---|---|---|
| `settings.json` | `src/settings.py` | Search provider, TTS/STT, research timeouts, agent budgets, encrypted API keys |
| `features.json` | `src/settings.py` | Feature toggles (see below) |
| `auth.json` | `core/auth.py` | Users, bcrypt hashes, TOTP secrets |
| `presets.json` | `PresetManager` | Named chat presets |
| `integrations.json` | `src/integrations.py` | Custom API call definitions |
| `embedding_endpoint.json` | `src/embeddings.py` | Persisted embedding API config |
| `cookbook_state.json` | Cookbook | Model serve / download state |

### Feature Flags

```python
# src/settings.py
DEFAULT_FEATURES = {
    "web_search":      True,
    "web_fetch":       True,
    "deep_research":   False,
    "memory":          True,
    "document_editor": True,
    "rag":             True,
    "sensitive_filter": True,
    "gallery":         True,
}
```

Loaded via `load_features()` / `get_feature(key)` with a 2-second TTL cache. Admin toggles via Settings UI → `save_features()` writes back to `data/features.json`.

### Secrets Management

`src/secret_storage.py` provides Fernet symmetric encryption using a key stored in `data/.app_key` (generated on first run). Used for:
- Email account passwords (`email_accounts` table)
- API keys stored in DB (`model_endpoints`, `mcp_servers`)
- MCP OAuth tokens
- Document signatures

---

## 10. Extension Points

### A. Adding Agent Tools

1. Implement handler function in `src/tools/<domain>.py` or `src/agent_tools/<domain>.py`
2. Register in `TOOL_HANDLERS` dict in `src/agent_tools/__init__.py`
3. Add the fenced-code-block tag to `TOOL_TAGS` (for text-mode tool parsing)
4. Add JSON schema to `FUNCTION_TOOL_SCHEMAS` in `src/tool_schemas.py` (for native function calling)
5. Optionally update tool index / policy config

```python
# src/agent_tools/__init__.py
TOOL_HANDLERS = {
    "bash":        BashTool().execute,
    "web_search":  WebSearchTool().execute,
    "my_tool":     MyNewTool().execute,   # ← add here
    # … 50+ existing tools
}
```

### B. MCP (Model Context Protocol) Servers

- **Add at runtime**: via Admin UI or `POST /api/mcp` — no code changes needed
- `McpManager` (`src/mcp_manager.py`) connects stdio/SSE subprocesses and exposes their tools to the agent loop
- **Built-in servers** (e.g. Playwright browser MCP) auto-registered in `src/builtin_mcp.py`
- Per-server `disabled_tools` JSON column in the `mcp_servers` table for fine-grained control

### C. Memory Providers

The memory system is pluggable via an abstract base class:

```python
# src/memory_provider.py
class MemoryProvider(ABC):
    provider_id: str

    async def remember(self, text, *, owner, ...) -> MemoryRecord: ...
    async def recall(self, query, *, owner, top_k=5) -> List[MemorySearchHit]: ...
    async def list_memories(self, *, owner, limit=100) -> List[MemoryRecord]: ...

# Register alongside NativeMemoryProvider in src/app_initializer.py:
registry.register(MyCustomMemoryProvider())
```

### D. Scheduled Task Actions

Non-LLM automations can be registered in `src/builtin_actions.py`:

```python
async def action_my_feature(owner: str, **kwargs) -> Tuple[str, bool]:
    # Returns (result_message, success_bool)
    ...

BUILTIN_ACTIONS = {
    "tidy_sessions":       action_tidy_sessions,
    "consolidate_memory":  action_consolidate_memory,
    "my_feature":          action_my_feature,   # ← add here
}
```

Tasks reference actions by name when `task_type = "action"`.

### E. Outgoing Webhooks

```python
# src/webhook_manager.py
ALLOWED_EVENTS = frozenset({
    "session.created",
    "chat.completed",
    "chat.message",
    "webhook.test",
})
```

- Configure targets via Admin → Webhooks UI
- Payloads are HMAC-SHA256 signed; destination URLs are SSRF-protected
- Add new event types by extending `ALLOWED_EVENTS` and calling `webhook_manager.dispatch(event, payload)`

### F. API Tokens & External Agent Bridge

- Scoped bearer tokens (`chat`, `todos:read`, `email:send`, …) created via Admin UI
- `routes/codex_routes.py` — HTTP surface designed for Codex / Claude plugin integration
- Tokens are bcrypt-hashed at rest; prefix stored for display

### G. Custom Integrations

- `src/integrations.py` — preset + custom HTTP API call definitions stored in `data/integrations.json`
- Executed via the `do_api_call` / `do_app_api` agent tools — no code changes required

### H. User Tools (Sandboxed Mini-Apps)

- `user_tools` table stores HTML/JS mini-app source
- Rendered in sandboxed iframes at `GET /api/tools/{id}/render`
- Persistent key-value storage via `user_tool_data` table
- Effectively allows end-users to ship custom UI widgets without server code

### I. Adding a New Route Module

The project uses a consistent factory pattern:

```python
# routes/my_feature_routes.py
def setup_my_feature_routes(service: MyService, ...) -> APIRouter:
    router = APIRouter(prefix="/api/myfeature", tags=["myfeature"])

    @router.get("/")
    async def list_items(request: Request):
        owner = request.state.current_user
        return await service.list(owner=owner)

    return router

# app.py
from routes.my_feature_routes import setup_my_feature_routes
app.include_router(setup_my_feature_routes(my_service_instance))
```

If the feature needs a SPA deep-link route, add a path to the catch-all list in `app.py`.

### J. Adding a Frontend Module

1. Create `static/js/myfeature.js` as a standard ES module with a default export
2. Import and initialise in `static/app.js`
3. Optionally add `<script type="module" src="/static/js/myfeature.js">` in `index.html`
4. Add a deep-link pathname to the FastAPI SPA route list in `app.py` if the feature needs a dedicated URL

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Monolith over microservices** | Single FastAPI process; optional sidecar containers (SearXNG, ChromaDB, ntfy) via Docker Compose for features that benefit from isolation |
| **OpenAI-compatible LLM abstraction** | One HTTP client, many provider adapters; local-first (Ollama, vLLM, llama.cpp via Cookbook) with cloud fallback |
| **Dual tool invocation** | Fenced code blocks (`\`\`\`bash`) work with any model; native `tool_calls` used when the endpoint reports support |
| **Owner-scoped multi-tenancy** | `owner` column on most tables; set by middleware so route handlers never need to think about it |
| **Fail-closed security** | Orphan session purge, reserved usernames, SSRF blocks on webhooks and page fetches, path confinement for file tools |
| **No frontend build step** | Raw ES modules with `Cache-Control: no-cache`; eliminates build tooling complexity at the cost of no tree-shaking |
| **Inline SQLite migrations** | `_migrate_*` functions are idempotent and self-contained; simpler than Alembic for self-hosted single-file databases |
| **Embedding lanes** | Separate Chroma collections per embedding model/dimension; allows switching embedding models without corrupting existing vectors |
| **Graceful degradation** | RAG, memory vectors, MCP, and ChromaDB are all optional; the application runs with reduced features if any are unavailable |

---

## Quick Reference: Critical File Paths

| Concern | Path |
|---|---|
| App entry point | `app.py` |
| Startup initialisation | `src/app_initializer.py` |
| Authentication | `core/auth.py`, `routes/auth_routes.py` |
| Middleware | `core/middleware.py` |
| Database models + migrations | `core/database.py` |
| LLM client | `src/llm_core.py` |
| Agent loop | `src/agent_loop.py` |
| Tool registry | `src/agent_tools/__init__.py` |
| Chat API | `routes/chat_routes.py` |
| Chat context builder | `src/chat_processor.py` |
| RAG / vector search | `src/rag_vector.py`, `src/embedding_lanes.py` |
| Memory provider | `src/memory_provider.py`, `src/memory_vector.py` |
| Web search | `services/search/core.py`, `services/search/ranking.py` |
| MCP manager | `src/mcp_manager.py`, `src/builtin_mcp.py` |
| Scheduled tasks | `src/task_scheduler.py`, `src/builtin_actions.py` |
| Pydantic config | `src/config.py` |
| Runtime settings + features | `src/settings.py` |
| Secret storage | `src/secret_storage.py` |
| Frontend entry | `static/app.js`, `static/index.html` |
| Environment variable reference | `.env.example` |
