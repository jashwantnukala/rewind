#include "history.h"

Kind kindFromString(const std::string& s) {
    if (s == "type") return Kind::Type;
    if (s == "delete") return Kind::Delete;
    if (s == "paste") return Kind::Paste;
    if (s == "cut") return Kind::Cut;
    return Kind::Replace;
}
const char* kindName(Kind k) {
    switch (k) {
        case Kind::Init: return "init";   case Kind::Type: return "type";
        case Kind::Delete: return "delete"; case Kind::Paste: return "paste";
        case Kind::Cut: return "cut";     default: return "replace";
    }
}

EditorHistory::EditorHistory() { reset(""); }
EditorHistory::~EditorHistory() { clearList(); }

void EditorHistory::clearList() {
    Node* p = head_;
    while (p) { Node* nx = p->next; delete p; p = nx; }
    head_ = current_ = nullptr;
    size_ = 0;
}

void EditorHistory::reset(const std::string& initialText) {
    clearList();
    text_ = initialText;
    nextId_ = 0; caret_ = 0;
    totalEdits_ = groupedEdits_ = discardedTotal_ = lastDiscarded_ = 0;
    lastMerged_ = false; trace_.clear();
    head_ = current_ = new Node(nextId_++, Kind::Init, 0, "", "", 0);   // sentinel "Initial state"
    size_ = 1;
}

int EditorHistory::currentIndex() const {
    int i = 0;
    for (const Node* p = head_; p && p != current_; p = p->next) ++i;
    return i;
}

// A singly linked node cannot look backwards, so we scan from the head.
Node* EditorHistory::findPrevious(const Node* target) {
    trace_.clear();
    Node* p = head_;
    while (p) {
        trace_.push_back(p->id);
        if (p->next == target) return p;
        p = p->next;
    }
    return nullptr;
}

int EditorHistory::freeAfter(Node* from) {
    int n = 0;
    Node* p = from->next;
    from->next = nullptr;
    while (p) { Node* nx = p->next; delete p; p = nx; ++n; --size_; }
    return n;
}

// Smart grouping: continuous typing / backspacing / forward-deleting folds into the current node.
bool EditorHistory::tryMerge(Node* n, size_t pos, const std::string& rem, const std::string& ins,
                             Kind k, long long now) {
    if (n == head_ || n->kind != k || now - n->timeMs > GROUP_WINDOW_MS) return false;
    if (k == Kind::Type && rem.empty() && n->removed.empty() && !n->inserted.empty() &&
        pos == n->pos + n->inserted.size() && n->inserted.back() != '\n') {
        // Close the group when a word-boundary character is appended (space, newline, punctuation).
        // This makes undo step back one word/sentence at a time even when typing fast,
        // matching the behaviour of VS Code and most modern editors.
        static const std::string BREAK_CHARS = " \t\n.,;:!?()[]{}\"'`/\\-_=+*&^%$#@~|<>";
        if (!ins.empty() && BREAK_CHARS.find(ins[0]) != std::string::npos) return false;
        n->inserted += ins;                       // typed right after the previous chunk
    } else if (k == Kind::Delete && ins.empty() && n->inserted.empty()) {
        if (pos + rem.size() == n->pos) { n->removed = rem + n->removed; n->pos = pos; }   // Backspace
        else if (pos == n->pos)         { n->removed += rem; }                              // Delete key
        else return false;
    } else return false;
    n->timeMs = now;
    return true;
}

bool EditorHistory::record(size_t pos, const std::string& removed, const std::string& inserted,
                           Kind kind, bool allowGrouping, long long nowMs) {
    lastMerged_ = false; lastDiscarded_ = 0; trace_.clear();
    if (pos > text_.size() || text_.compare(pos, removed.size(), removed) != 0) return false;  // out of sync
    if (removed.empty() && inserted.empty()) return true;                                     // no-op

    text_.replace(pos, removed.size(), inserted);
    caret_ = pos + inserted.size();
    ++totalEdits_;

    if (current_->next) {
        // BRANCHING: user edited after undoing -> the old redo chain is now unreachable. Free it.
        lastDiscarded_ = freeAfter(current_);
        discardedTotal_ += lastDiscarded_;
    } else if (allowGrouping && tryMerge(current_, pos, removed, inserted, kind, nowMs)) {
        lastMerged_ = true; ++groupedEdits_;
        return true;
    }
    Node* n = new Node(nextId_++, kind, pos, removed, inserted, nowMs);
    current_->next = n;      // append after current (current is now always the tail)
    current_ = n;
    ++size_;
    return true;
}

bool EditorHistory::undo() {
    lastMerged_ = false; lastDiscarded_ = 0; trace_.clear();
    if (current_ == head_) return false;
    Node* prev = findPrevious(current_);                              // O(n) traversal from head
    text_.replace(current_->pos, current_->inserted.size(), current_->removed);   // reverse the delta
    caret_ = current_->pos + current_->removed.size();
    current_ = prev;
    return true;
}

bool EditorHistory::redo() {
    lastMerged_ = false; lastDiscarded_ = 0; trace_.clear();
    if (!current_->next) return false;
    current_ = current_->next;                                        // O(1)
    text_.replace(current_->pos, current_->removed.size(), current_->inserted);   // re-apply the delta
    caret_ = current_->pos + current_->inserted.size();
    trace_.push_back(current_->id);
    return true;
}

bool EditorHistory::goTo(int index) {
    if (index < 0 || index >= size_) return false;
    int cur = currentIndex();
    while (cur > index) { undo(); --cur; }
    while (cur < index) { redo(); ++cur; }
    return true;
}

// ---------- labels & statistics ----------
static std::string preview(const std::string& s, size_t maxChars = 22) {
    std::string out; size_t chars = 0;
    for (size_t i = 0; i < s.size(); ++i) {
        unsigned char c = s[i];
        if ((c & 0xC0) != 0x80) {
            if (chars == maxChars) { out += "\xE2\x80\xA6"; break; }
            ++chars;
        }
        if (c == '\n') out += "\xE2\x86\xB5"; else if (c == '\t') out += "\xE2\x87\xA5"; else out += (char)c;
    }
    return out;
}
static int countChars(const std::string& s) {
    int n = 0;
    for (unsigned char c : s) if ((c & 0xC0) != 0x80) ++n;
    return n;
}

std::string EditorHistory::describe(const Node& n) {
    const std::string L = "\xE2\x80\x9C", R = "\xE2\x80\x9D";
    switch (n.kind) {
        case Kind::Init:    return "Initial state";
        case Kind::Type:    return "Typed " + L + preview(n.inserted) + R;
        case Kind::Delete:  return "Deleted " + L + preview(n.removed) + R;
        case Kind::Cut:     return "Cut " + L + preview(n.removed) + R;
        case Kind::Paste:   return "Pasted " + std::to_string(countChars(n.inserted)) + " chars";
        default:            return "Replaced " + L + preview(n.removed, 12) + R + " with " + L + preview(n.inserted, 12) + R;
    }
}

TextStats EditorHistory::computeStats(const std::string& s) {
    TextStats st; bool inWord = false;
    for (unsigned char c : s) {
        bool space = (c == ' ' || c == '\n' || c == '\t' || c == '\r');
        if ((c & 0xC0) != 0x80) { ++st.chars; if (!space) ++st.charsNoSpace; }
        if (c == '\n') ++st.lines;
        if (space) inWord = false; else if (!inWord) { inWord = true; ++st.words; }
    }
    return st;
}
