<div align="center">

# ⏪ REWIND

**A text editor where Undo / Redo is a live, hand-written singly linked list.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-rewind--s8o1.onrender.com-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://rewind-s8o1.onrender.com/)
&nbsp;
[![C++17](https://img.shields.io/badge/C%2B%2B-17-00599C?style=for-the-badge&logo=c%2B%2B&logoColor=white)](https://en.cppreference.com/w/cpp/17)
&nbsp;
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](./Dockerfile)

<br/>

**[→ Open the live editor](https://rewind-s8o1.onrender.com/)**

*First load may take ~30 s (free-tier cold start). Subsequent loads are instant.*

</div>

---

## What it is

Most editors manage history with two hidden stacks. REWIND makes the data structure the point: **all document state and the complete edit history live in a hand-written singly linked list in C++** — no `std::list`, no `std::stack`, no browser undo. The browser is only the screen.

Every keystroke, delete, or paste appends a node. Undo walks backward from `head`. Redo follows `current->next`. The visualizer animates every pointer update in real time.

```
head → [Initial state] → [Typed "Hello"] → [Deleted "lo"] → [Pasted 12 chars] → NULL
                                                  ^
                                               current
```

---

## Features

| | |
|---|---|
| **Live list visualizer** | Nodes, `next` arrows, `head` / `current` / `NULL` labels update on every keystroke |
| **Animated undo traversal** | Because there's no `prev` pointer, Undo walks from `head` and highlights each visited node in amber — making the O(n) cost visible |
| **O(1) Redo** | Follows `current->next` with no traversal |
| **Word-boundary grouping** | Continuous typing merges into one node; a space or punctuation starts a fresh node — so Ctrl+Z steps back one word at a time, not one character |
| **Branch discarding** | Edit after an undo and every future node is freed; orphaned nodes dissolve on the canvas |
| **Time-travel slider** | Drag to scrub through every historical state |
| **Timeline** | Click any entry to jump directly to that state |
| **Find & Replace** | Replace-All is recorded as a single undoable action |
| **File I/O** | New · Open · Save (native dialog in Chrome/Edge, download elsewhere) |
| **Statistics** | Words, characters, lines, reading time, node count, grouped edits, freed nodes |

---

## How the data structure works

### The Node

```cpp
struct Node {
    int         id;        // monotonically increasing
    Kind        kind;      // Type | Delete | Paste | Cut | Replace
    size_t      pos;       // byte offset in the document
    std::string removed;   // text deleted — needed to Undo
    std::string inserted;  // text inserted — needed to Redo
    long long   timeMs;    // timestamp of last merged edit
    Node*       next;      // the only link — singly linked
};
```

Every edit is stored as a **delta** (position + what was removed + what was inserted), not a full copy. Applying an edit: replace `removed` with `inserted` at `pos`. Reversing it: the exact opposite.

### Complexity

| Operation | How | Cost |
|---|---|:---:|
| **Record** | Append new node after `current`; or merge into `current` if within grouping window | O(1) |
| **Undo** | Walk list from `head` until `p->next == current`, reverse delta, set `current = p` | **O(n)** |
| **Redo** | `current = current->next`, apply delta | **O(1)** |
| **Time travel** | Repeat undo/redo until target index reached | O(n × steps) |

> **Why O(n) Undo?**  
> A singly linked list has no `prev` pointer, so finding the predecessor always costs a full traversal from `head`. That is the tradeoff the project exists to demonstrate. A doubly linked list or a stack would give O(1) undo — but you wouldn't see the walk.

### Smart Grouping (`EditorHistory::tryMerge`)

A new edit merges into `current` when **all** of these hold:
- Same kind (type / delete / backspace)
- Within 1 000 ms of the last merged edit
- Contiguous position in the text
- The node does not end with `\n`
- The incoming character is **not** a word-boundary (`space`, punctuation, etc.)

Spaces and punctuation always close the current node, so Undo steps back one natural word at a time.

### Request flow

```
textarea input
  → JS diff (common prefix / suffix)
  → POST /api/edit {pos, removed, inserted, kind, group}
  → C++ EditorHistory::record()
  → JSON {text, nodes[], currentIndex, trace[], stats}
  → JS redraws editor, timeline, slider, visualizer
```

Positions are **byte offsets in UTF-8**, so emoji and accented characters work. If the browser and backend ever disagree the backend returns HTTP 409 and the editor re-syncs from the canonical backend text.

---

## API

| Method | Endpoint | Body | Effect |
|---|---|---|---|
| GET | `/api/state` | — | Full state snapshot |
| POST | `/api/edit` | `{pos, removed, inserted, kind, group}` | Record an edit |
| POST | `/api/undo` | — | Step back one node |
| POST | `/api/redo` | — | Step forward one node |
| POST | `/api/goto` | `{index}` | Time-travel to any node |
| POST | `/api/reset` | `{text}` | New / open file: free list, start over |

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl Z` / `Cmd Z` | Undo |
| `Ctrl Y` / `Ctrl Shift Z` | Redo |
| `Ctrl S` | Save |
| `Ctrl O` | Open file |
| `Ctrl H` | Find & Replace |
| `Alt N` | New document |

---

## Run locally

Requires a C++17 compiler and a modern browser. The two dependencies (`cpp-httplib`, `nlohmann/json`) are bundled as single headers in `backend/third_party/`.

```bash
git clone https://github.com/jashwantnukala/rewind.git
cd rewind
make
./rewind          # open http://localhost:8080
```

**Windows (MinGW-w64)**
```bash
mingw32-make
rewind.exe
```

**Docker**
```bash
docker build -t rewind .
docker run -p 8080:8080 rewind
```

---

## Project layout

```
backend/
  history.h / history.cpp   singly linked list · delta engine · grouping · undo/redo
  server.cpp                HTTP server · JSON API (thin glue layer)
  third_party/              httplib.h · json.hpp (bundled, no install needed)
frontend/
  index.html                markup & history panel
  style.css                 dark-mode UI & animations
  app.js                    input diffing · API calls · live visualizer
Dockerfile                  multi-stage build for deployment
Makefile                    local build shortcut
```
