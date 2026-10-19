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

### Algorithms

All five operations work on the same three things: the list (`head` is a sentinel "Initial state" node, so the list is never empty), the `current` pointer, and the document `text`.

#### 1. Record an edit

```text
Record(pos, removed, inserted, kind, allowGrouping, now):
 1  if pos > length(text) or text[pos .. pos+length(removed)] != removed:
 2      return FAIL                      // browser out of sync -> HTTP 409, editor re-syncs
 3  if removed and inserted are both empty:
 4      return OK                        // nothing changed
 5  text <- replace `removed` with `inserted` at pos
 6  if current.next != NULL:             // user undid something, then typed: BRANCH
 7      free every node after current    // the old redo chain is unreachable
 8      current.next <- NULL
 9  else if allowGrouping and TryMerge(current, pos, removed, inserted, kind, now):
10      return OK                        // folded into the existing node, no new node
11  n <- new Node(id++, kind, pos, removed, inserted, now)
12  current.next <- n                    // append at the tail
13  current <- n
14  return OK
```

#### 2. Smart grouping (`TryMerge`)

```text
TryMerge(node, pos, removed, inserted, kind, now):
 1  if node == head or node.kind != kind or now - node.time > 1000 ms:
 2      return false
 3  if kind == Type:
 4      require removed is empty and node.removed is empty
 5      require pos == node.pos + length(node.inserted)        // typed right after the last chunk
 6      require node.inserted does not end with '\n'
 7      require inserted is not a word boundary (space / punctuation)
 8      node.inserted <- node.inserted + inserted
 9  else if kind == Delete:
10      require inserted is empty and node.inserted is empty
11      if pos + length(removed) == node.pos:                  // Backspace run
12          node.removed <- removed + node.removed
13          node.pos <- pos
14      else if pos == node.pos:                               // Delete-key run
15          node.removed <- node.removed + removed
16      else return false
17  else return false
18  node.time <- now
19  return true
```

#### 3. Undo (O(n))

```text
Undo():
 1  if current == head:
 2      return FAIL                      // empty history: "Nothing to undo"
 3  p <- head
 4  while p.next != current:             // no prev pointer, so scan from the head
 5      record p.id in trace             // the visualizer highlights these in amber
 6      p <- p.next
 7  text <- replace `inserted` with `removed` at current.pos      // reverse the delta
 8  current <- p
 9  return OK
```

#### 4. Redo (O(1))

```text
Redo():
 1  if current.next == NULL:
 2      return FAIL                      // nothing to redo
 3  current <- current.next              // single pointer hop
 4  text <- replace `removed` with `inserted` at current.pos      // re-apply the delta
 5  return OK
```

#### 5. Time travel and reset

```text
GoTo(index):
 1  if index < 0 or index >= size:  return FAIL
 2  c <- position of current in the list           // one scan from head
 3  while c > index:  Undo();  c <- c - 1
 4  while c < index:  Redo();  c <- c + 1
 5  return OK

Reset(newText):
 1  free every node, including head
 2  text <- newText
 3  head <- current <- new Node(Init)              // fresh sentinel
```

#### Worked example: edit, undo, branch

```text
Type "ab"         head -> [T "ab"]                                  -> NULL
                                  ^current
Type " cd"        head -> [T "ab"] -> [T " cd"]                     -> NULL
                                            ^current
Undo              head -> [T "ab"] -> [T " cd"]                     -> NULL
                              ^current      (redo side)
Type "X"          head -> [T "ab"] -> [T "X"]   [T " cd"] is freed  -> NULL
(branch)                              ^current
Redo              FAIL: current.next == NULL, so the old " cd" is gone for good
```

#### Edge cases handled

| Situation | Behaviour |
|---|---|
| Undo at `head` | Returns FAIL, state unchanged, UI shows "Nothing to undo" |
| Redo when `current.next == NULL` | Returns FAIL, UI shows "Nothing to redo" |
| Many undos in a row | Each one re-scans from `head`; the traversal grows shorter as `current` moves left |
| Edit after undo | Redo chain is freed before the new node is appended (no leaked nodes) |
| `GoTo` outside `[0, size-1]` | Rejected, no change |
| Browser text differs from backend text | Edit rejected (HTTP 409), editor re-syncs from the backend |
| New / Open file | `Reset` frees the whole list and starts again with a single head node |

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
