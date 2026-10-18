// history.h - Undo/Redo engine built on a hand-written SINGLY LINKED LIST.
//
//   head -> [Initial] -> [Edit 1] -> [Edit 2] -> [Edit 3] -> NULL
//                                       ^
//                                    current
//
// * Every node stores ONE edit as a delta (what was removed, what was inserted, where).
// * Undo : find the node BEFORE `current` by walking from `head`  -> O(n)
//          (a singly linked list has no prev pointer), then reverse the delta.
// * Redo : follow current->next                                    -> O(1)
// * New edit after an undo: every node after `current` is freed (the "redo branch"
//   is discarded) and the new node is appended.
#pragma once
#include <cstddef>
#include <string>
#include <vector>

enum class Kind { Init, Type, Delete, Paste, Cut, Replace };

Kind kindFromString(const std::string& s);
const char* kindName(Kind k);

// One node of the singly linked list = one (possibly grouped) user action.
struct Node {
    int         id;        // unique, increases over time
    Kind        kind;
    size_t      pos;       // byte offset in the document where the edit happened
    std::string removed;   // text that the edit deleted   (needed to UNDO)
    std::string inserted;  // text that the edit inserted  (needed to REDO)
    long long   timeMs;    // wall-clock time of the last edit merged into this node
    Node*       next;      // the ONLY link: singly linked
    Node(int id_, Kind k, size_t p, std::string r, std::string i, long long t)
        : id(id_), kind(k), pos(p), removed(std::move(r)), inserted(std::move(i)), timeMs(t), next(nullptr) {}
};

struct TextStats { int words = 0, chars = 0, charsNoSpace = 0, lines = 1; };

class EditorHistory {
public:
    static constexpr long long GROUP_WINDOW_MS = 1000;  // typing pauses longer than this start a new action

    EditorHistory();
    ~EditorHistory();
    EditorHistory(const EditorHistory&) = delete;
    EditorHistory& operator=(const EditorHistory&) = delete;

    void reset(const std::string& initialText);   // new / open file: free list, start over

    // Apply an edit and log it. Returns false if (pos, removed) does not match the document.
    bool record(size_t pos, const std::string& removed, const std::string& inserted,
                Kind kind, bool allowGrouping, long long nowMs);
    bool undo();            // false when already at the head (nothing to undo)
    bool redo();            // false when current->next is NULL
    bool goTo(int index);   // time travel to node number `index` (0 = head)

    // --- read-only accessors used by the server to build JSON ---
    const std::string& text() const { return text_; }
    const Node* head() const { return head_; }
    const Node* current() const { return current_; }
    int size() const { return size_; }
    int currentIndex() const;
    size_t caret() const { return caret_; }
    bool lastMerged() const { return lastMerged_; }
    int lastDiscarded() const { return lastDiscarded_; }
    const std::vector<int>& lastTrace() const { return trace_; }
    int totalEdits() const { return totalEdits_; }
    int groupedEdits() const { return groupedEdits_; }
    int discardedTotal() const { return discardedTotal_; }

    static std::string describe(const Node& n);   // human readable label
    static TextStats computeStats(const std::string& s);

private:
    Node* findPrevious(const Node* target);   // walk from head until p->next == target
    int   freeAfter(Node* from);              // delete everything after `from`, return count
    bool  tryMerge(Node* n, size_t pos, const std::string& rem, const std::string& ins, Kind k, long long now);
    void  clearList();

    Node* head_ = nullptr;
    Node* current_ = nullptr;
    int   size_ = 0, nextId_ = 0;
    std::string text_;
    size_t caret_ = 0;
    bool  lastMerged_ = false;
    int   lastDiscarded_ = 0;
    std::vector<int> trace_;     // ids visited by the last findPrevious() (for the visualizer)
    int   totalEdits_ = 0, groupedEdits_ = 0, discardedTotal_ = 0;
};
