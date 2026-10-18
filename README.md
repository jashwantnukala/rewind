# REWIND: a text editor whose Undo/Redo is a singly linked list

A college Data Structures project. The browser is only the screen; **all document state and the whole
undo/redo history live in C++**, stored in a hand-written **singly linked list** (no `std::list`,
no `std::stack`, no browser undo).

```
head -> [Initial state] -> [Typed "Hello"] -> [Deleted "lo"] -> [Pasted 12 chars] -> NULL
                                                   ^
                                                current
```

## Build and run

You need a C++17 compiler (g++ 8+ / clang / MinGW-w64) and any modern browser. Nothing else to install:
the two single-header libraries (`cpp-httplib` for HTTP, `nlohmann/json` for JSON) are bundled in
`backend/third_party/`.

**Linux / macOS**
```bash
make
./rewind            # or: ./rewind 9000  to use another port
```

**Windows (MinGW-w64 / MSYS2)**
```bash
mingw32-make
rewind.exe
```
No make? Compile by hand:
```bash
# Linux / macOS
g++ -std=c++17 -O2 -pthread -Ibackend/third_party backend/server.cpp backend/history.cpp -o rewind
# Windows
g++ -std=c++17 -O2 -D_WIN32_WINNT=0x0A00 -Ibackend/third_party backend/server.cpp backend/history.cpp -o rewind.exe -lws2_32 -lwsock32
```

Run it **from the project root** (the folder that contains `frontend/`), then open
**http://localhost:8080**. Stop with Ctrl+C. The first load fetches two Google Fonts; offline it falls back to system fonts and works the same.

## Features

| Area | What it does |
|---|---|
| Editing | Type, delete, select, replace, cut/copy/paste, Find and Replace (Replace all = one undoable action) |
| Undo / Redo | Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z (Cmd on macOS) and toolbar buttons; the browser's own undo is disabled |
| Smart grouping | Continuous typing, Backspace runs and Delete runs merge into one node (pause > 1 s, moving the caret, or Enter starts a new one) |
| Branching | Edit after undoing and every node after `current` is freed; the visualizer shows them dissolving |
| Timeline | Click any entry to jump to that state |
| Time-travel slider | Drag to scrub through every state |
| Live visualizer | Nodes, `next` pointers, `head`, `current`, `NULL`; undo shows the head-to-previous traversal in amber |
| Statistics | Words, characters, lines, reading time, plus list stats (nodes, undo/redo steps, grouped keys, nodes freed) |
| Files | New (Alt+N), Open (Ctrl+O), Save (Ctrl+S; uses the native save dialog in Chrome/Edge, a download elsewhere) |
| Shortcuts | Ctrl+H opens Find and Replace |

## How the data structure works (for the viva)

**Node** (`backend/history.h`): one user action stored as a *delta*, not a full copy of the text.

```cpp
struct Node { int id; Kind kind; size_t pos; string removed, inserted; long long timeMs; Node* next; };
```

Applying an edit = "at `pos`, replace `removed` with `inserted`". Reversing it = the opposite replacement.

| Operation | Algorithm | Cost |
|---|---|---|
| **Record edit** | If `current->next` exists, free all nodes after `current` (branch discarded). Otherwise try to merge into `current` (grouping). Else `new Node`, `current->next = node`, `current = node`. | O(1), O(k) to free k nodes |
| **Undo** | Walk from `head` until `p->next == current` (a singly linked node has no `prev`), reverse `current`'s delta, `current = p`. | **O(n)** |
| **Redo** | `current = current->next`, re-apply its delta. | **O(1)** |
| **Jump to index** | Repeat undo/redo until the index is reached. | O(n * steps) |
| **Empty history** | `head` is a sentinel "Initial state" node. Undo at `head` and redo at `NULL` return false, so the UI shows a message. | O(1) |

Why a sentinel head? It means the list is never empty, so `current` is never null and "undo everything"
simply lands on the initial text.

Why O(n) undo is acceptable here: it is exactly the cost of using a *singly* linked list, which is what the
project demonstrates (a doubly linked list or a stack would make it O(1)). Redo is the cheap direction.

### Smart grouping (`EditorHistory::tryMerge`)
A new edit merges into `current` only when all of these hold: `current` is the tail, same kind, within 1000 ms,
and it is contiguous (typing continues at `pos + inserted.size()`; Backspace ends where the node starts;
Delete starts where the node starts). A node ending in a newline is closed.

### Request flow
```
textarea input -> JS diff (common prefix/suffix) -> POST /api/edit {pos, removed, inserted, kind}
             -> C++ EditorHistory::record() -> JSON {text, nodes[], currentIndex, trace[], stats}
             -> JS redraws editor stats, timeline, slider, linked-list visualizer
```
Positions are byte offsets in UTF-8, so emoji and accented characters work. If the browser and backend ever
disagree, the backend rejects the edit (HTTP 409) and the editor re-syncs from the backend's text.

### API
| Endpoint | Body | Effect |
|---|---|---|
| `GET /api/state` | | Current text, nodes, stats |
| `POST /api/edit` | `{pos, removed, inserted, kind, group}` | Record an edit |
| `POST /api/undo`, `/api/redo` | | Move `current` |
| `POST /api/goto` | `{index}` | Time travel |
| `POST /api/reset` | `{text}` | New / open file: frees the list, starts over |

## Project layout
```
backend/history.h, history.cpp   the singly linked list + undo/redo + grouping + stats  (the important part)
backend/server.cpp               HTTP server and JSON API (thin glue)
backend/third_party/             httplib.h, json.hpp (bundled)
frontend/index.html, style.css, app.js
Makefile
```

## Notes
* The server holds one document, so use a single browser tab. Refreshing the page keeps your text and history, because they live in the backend.
* The server only listens on `127.0.0.1`.
* Possible extensions: per-session documents, a doubly linked version to compare O(1) undo, persisting history to disk.
