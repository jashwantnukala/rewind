// server.cpp - tiny HTTP layer. Serves the frontend and exposes the EditorHistory as a JSON API.
#include <chrono>
#include <filesystem>
#include <iostream>
#include <mutex>
#include "httplib.h"
#include "json.hpp"
#include "history.h"

using json = nlohmann::json;
static EditorHistory g_doc;     // the one open document + its linked-list history
static std::mutex    g_lock;

static long long nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

// Serialise the whole state (the frontend re-renders from this after every operation).
static json snapshot(const std::string& op, bool ok = true) {
    json nodes = json::array();
    int idx = 0;
    for (const Node* p = g_doc.head(); p; p = p->next, ++idx)
        nodes.push_back({{"id", p->id}, {"index", idx}, {"kind", kindName(p->kind)},
                         {"label", EditorHistory::describe(*p)}, {"pos", p->pos},
                         {"ins", p->inserted.size()}, {"rem", p->removed.size()}, {"time", p->timeMs}});
    TextStats st = EditorHistory::computeStats(g_doc.text());
    int cur = g_doc.currentIndex();
    return {{"ok", ok}, {"op", op}, {"text", g_doc.text()}, {"caret", g_doc.caret()},
            {"currentIndex", cur}, {"size", g_doc.size()},
            {"canUndo", cur > 0}, {"canRedo", cur < g_doc.size() - 1},
            {"merged", g_doc.lastMerged()}, {"discarded", g_doc.lastDiscarded()},
            {"trace", g_doc.lastTrace()}, {"nodes", nodes},
            {"stats", {{"words", st.words}, {"chars", st.chars}, {"charsNoSpace", st.charsNoSpace}, {"lines", st.lines}}},
            {"history", {{"totalEdits", g_doc.totalEdits()}, {"grouped", g_doc.groupedEdits()},
                         {"discardedTotal", g_doc.discardedTotal()}}}};
}

static void send(httplib::Response& res, const json& j, int status = 200) {
    res.status = status;
    res.set_content(j.dump(-1, ' ', false, json::error_handler_t::replace), "application/json");
}

int main(int argc, char** argv) {
    // Cloud platforms (Fly.io, Render, Railway) inject PORT via environment.
    // Fall back to the CLI argument or 8080 for local development.
    int port = 8080;
    if (const char* env = std::getenv("PORT")) port = std::atoi(env);
    else if (argc > 1) port = std::atoi(argv[1]);
    std::string root = std::filesystem::exists("frontend") ? "frontend" : "../frontend";

    httplib::Server svr;
    svr.set_default_headers({{"Cache-Control", "no-store"}});
    if (!svr.set_mount_point("/", root)) { std::cerr << "Cannot find the 'frontend' folder. Run from the project root.\n"; return 1; }

    svr.Get("/api/state", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> g(g_lock); send(res, snapshot("state"));
    });
    svr.Post("/api/edit", [](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> g(g_lock);
        try {
            json b = json::parse(req.body);
            bool ok = g_doc.record(b.at("pos").get<size_t>(), b.at("removed").get<std::string>(),
                                   b.at("inserted").get<std::string>(), kindFromString(b.value("kind", "replace")),
                                   b.value("group", true), nowMs());
            send(res, snapshot(ok ? "edit" : "resync", ok), ok ? 200 : 409);
        } catch (const std::exception& e) { send(res, {{"ok", false}, {"error", e.what()}}, 400); }
    });
    svr.Post("/api/undo", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> g(g_lock); bool ok = g_doc.undo(); send(res, snapshot("undo", ok));
    });
    svr.Post("/api/redo", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> g(g_lock); bool ok = g_doc.redo(); send(res, snapshot("redo", ok));
    });
    svr.Post("/api/goto", [](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> g(g_lock);
        try { bool ok = g_doc.goTo(json::parse(req.body).at("index").get<int>()); send(res, snapshot("goto", ok)); }
        catch (const std::exception& e) { send(res, {{"ok", false}, {"error", e.what()}}, 400); }
    });
    svr.Post("/api/reset", [](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> g(g_lock);
        try { g_doc.reset(json::parse(req.body).value("text", "")); send(res, snapshot("reset")); }
        catch (const std::exception& e) { send(res, {{"ok", false}, {"error", e.what()}}, 400); }
    });

    std::cout << "REWIND running at http://0.0.0.0:" << port << "  (Ctrl+C to stop)\n";
    if (!svr.listen("0.0.0.0", port)) { std::cerr << "Could not bind port " << port << ". Try: ./rewind 9000\n"; return 1; }
}
