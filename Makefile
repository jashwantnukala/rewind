CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -pthread -Ibackend/third_party
LDLIBS   :=
TARGET   := rewind
ifeq ($(OS),Windows_NT)
  CXXFLAGS += -D_WIN32_WINNT=0x0A00
  LDLIBS   += -lws2_32 -lwsock32
  TARGET   := rewind.exe
endif

$(TARGET): backend/server.cpp backend/history.cpp backend/history.h
	$(CXX) $(CXXFLAGS) backend/server.cpp backend/history.cpp -o $(TARGET) $(LDLIBS)

run: $(TARGET)
	./$(TARGET)

clean:
	rm -f rewind rewind.exe
