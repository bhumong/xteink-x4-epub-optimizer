"""Force C17 for C translation units in the native simulator build.

PlatformIO's native platform passes no -std to the C compiler. GCC 14 still
defaulted to C17, but GCC 15 defaults to C23, where `bool`, `true`, and
`false` are keywords. The QRCode dependency still defines those names for C89
and therefore no longer compiles. C++ keeps its own -std=gnu++2a; this only
changes $CFLAGS.
"""

Import("env")

env.Append(CFLAGS=["-std=gnu17"])
