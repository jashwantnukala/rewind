<div align="center">

# ⏪ REWIND

**A text editor where Undo / Redo is an interactive, hand-crafted singly linked list.**

[![Live Demo](https://img.shields.io/badge/Demo-Live%20on%20Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://rewind-s8o1.onrender.com/)
[![C++17](https://img.shields.io/badge/C++-17-00599C?style=for-the-badge&logo=c%2B%2B&logoColor=white)](https://en.cppreference.com/w/cpp/17)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

<br/>

👉 **[Try Live Demo: rewind-s8o1.onrender.com](https://rewind-s8o1.onrender.com/)** 👈

</div>

---

## 💡 About The Project

Most text editors handle Undo/Redo using two stacks (`undo_stack` and `redo_stack`). **REWIND** takes a different approach: **the browser is merely the display canvas — all document state and the complete history graph live entirely in C++**, powered by a raw, hand-written **singly linked list** (no `std::list`, no `std::stack`, and browser native undo is disabled).

As you type, delete, or paste, the editor visualizes the underlying data structure in real time: pointer updates, head sentinels, branch pruning, and step-by-step list traversals.

```
head -> [Initial state] -> [Typed "Hello"] -> [Deleted "lo"] -> [Pasted 12 chars] -> NULL
                                                    ^
                                                 current
```

---

## ✨ Features

- **Interactive Linked List Visualizer**: Live rendering of nodes, `next` pointers, `head`, `current`, and `NULL`.
- **Word-Boundary & Intelligent Grouping**: Natural undo steps! Typing fast groups characters into clean word units, while Backspace and Delete runs merge seamlessly without cluttering the list.
- **Visual O(n) Traversal**: Because singly linked nodes lack a `prev` pointer, an **Undo** requires scanning forward from `head` to find the predecessor node. REWIND traces and animates this traversal in amber directly in the UI.
- **O(1) Redo**: Follows `current->next` instantaneously.
- **Branch Discarding**: Editing after an undo trims all subsequent future nodes (`free()`). Watch orphaned nodes dissolve live on the canvas.
- **Time-Travel Slider & Timeline**: Drag the slider or click any node in history to rewind or fast-forward to that exact snapshot.
- **Full Text Operations**: Find & Replace (Replace-All operates as a single undoable delta), Cut/Copy/Paste, Word Count, Character Count, and Reading Time metrics.
- **File Management**: Create New (`Alt+N`), Open (`Ctrl+O`), and Save (`Ctrl+S`).

---

## 🧠 Data Structure & Algorithm Deep Dive

### Node Architecture (`backend/history.h`)
Instead of duplicating the full text on each keystroke, every node stores a **compact delta**:

```cpp
struct Node {
    int         id;        // Monotonically increasing ID
    Kind        kind;      // Type, Delete, Paste, Cut, Replace
    size_t      pos;       // Byte offset in document
    std::string removed;   // Deleted characters (used to UNDO)
    std::string inserted;  // Inserted characters (used to REDO)
    long long   timeMs;    // Timestamp of last merged action
    Node*       next;      // Singly linked pointer
};
```

Applying an edit means replacing `removed` with `inserted` at `pos`. Reversing it simply flips the replacement.

| Operation | Algorithm | Time Complexity |
|---|---|:---:|
| **Record Edit** | If `current->next` exists, prune future chain. Try grouping with `current`; otherwise allocate `new Node`, link `current->next = node`, and advance `current = node`. | **$O(1)$** ($O(k)$ to free $k$ discarded nodes) |
| **Undo** | Walk list from `head` until `p->next == current`, apply inverse delta of `current`, set `current = p`. | **$O(n)$** |
| **Redo** | Advance `current = current->next`, apply forward delta. | **$O(1)$** |
| **Jump to State** | Repeat undo or redo sequentially until target index is reached. | **$O(n \times \text{steps})$** |
| **Head Sentinel** | `head` is initialized as a dummy "Initial state" node. The list is never empty, ensuring `current` is never null. | **$O(1)$** |

> **Why $O(n)$ Undo is intentional**: Standard stacks achieve $O(1)$ undo. REWIND demonstrates the mechanics and algorithmic tradeoffs of a purely **singly linked list**, turning linear traversal into an educational, observable visualization.

---

## 🚀 Running Locally

### Prerequisites
- A C++17 compiler (`clang++`, `g++`, or MinGW-w64)
- `make` (optional)
- Modern web browser

All dependencies (`cpp-httplib` and `nlohmann/json`) are single-header libraries bundled in `backend/third_party/`. No package managers required.

### Quick Start (Linux / macOS)

```bash
# 1. Clone the repository
git clone https://github.com/jashwantnukala/rewind.git
cd rewind

# 2. Build and run
make
./rewind
```

Open **[http://localhost:8080](http://localhost:8080)** in your browser.

*(To bind to a custom port, pass it as an argument: `./rewind 9000`)*

### Windows (MinGW-w64 / MSYS2)

```bash
mingw32-make
rewind.exe
```

### Manual Compilation
```bash
# Linux / macOS
g++ -std=c++17 -O2 -pthread -Ibackend/third_party backend/server.cpp backend/history.cpp -o rewind

# Windows
g++ -std=c++17 -O2 -D_WIN32_WINNT=0x0A00 -Ibackend/third_party backend/server.cpp backend/history.cpp -o rewind.exe -lws2_32 -lwsock32
```

---

## 🐳 Docker Deployment

A multi-stage [Dockerfile](Dockerfile) is provided for minimal image size and fast builds.

```bash
# Build Docker image
docker build -t rewind .

# Run container
docker run -p 8080:8080 rewind
```
Access at **http://localhost:8080**.

---

## 📁 Repository Structure

```text
├── backend/
│   ├── history.h          # Core singly linked list definitions & delta engine
│   ├── history.cpp        # Traversal, grouping logic, and undo/redo algorithms
│   ├── server.cpp         # Lightweight HTTP API server & static file host
│   └── third_party/       # Single-header libraries (httplib.h, json.hpp)
├── frontend/
│   ├── index.html         # Workspace markup & history dashboard layout
│   ├── style.css          # Modern dark-mode UI theme & animations
│   └── app.js             # Canvas/DOM visualizer, input diffing & sync engine
├── Dockerfile             # Multi-stage production container build
├── fly.toml               # Fly.io deployment blueprint
├── Makefile               # Local build automation
└── README.md
```

---

## 📡 REST API Reference

The C++ backend exposes a lightweight JSON API:

| Method | Endpoint | Payload | Description |
|---|---|---|---|
| `GET` | `/api/state` | — | Returns current text, linked list nodes, and text metrics |
| `POST` | `/api/edit` | `{"pos", "removed", "inserted", "kind", "group"}` | Applies delta and appends/merges a history node |
| `POST` | `/api/undo` | — | Steps back one node ($O(n)$ traversal) |
| `POST` | `/api/redo` | — | Steps forward one node ($O(1)$) |
| `POST` | `/api/goto` | `{"index": number}` | Time-travels to any node in history |
| `POST` | `/api/reset` | `{"text": string}` | Resets buffer and reallocates linked list |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> (or <kbd>Cmd</kbd> + <kbd>Z</kbd>) | **Undo** (traverse to previous node) |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | **Redo** (advance to next node) |
| <kbd>Ctrl</kbd> + <kbd>H</kbd> | Open **Find and Replace** |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | Save document to local disk |
| <kbd>Ctrl</kbd> + <kbd>O</kbd> | Open local file |
| <kbd>Alt</kbd> + <kbd>N</kbd> | New document |
