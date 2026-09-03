# Installed by tools/sim/setup.sh into
# crosspoint-reader/crosspoint-firmware/platformio.local.ini, which that repo's
# .gitignore already excludes (*.local*). Do not edit the installed copy; edit
# this template and re-run setup.
#
# Based on crosspoint-simulator/sample-platformio-linux-wsl.ini for
# simulator@c55f168b. Diff against that file when bumping the simulator pin.

[env:simulator]
platform = native
lib_ldf_mode = deep+
lib_compat_mode = off
build_src_filter =
  +<*>
  ; Firmware-update code remains non-destructive in the simulator.
  -<network/FirmwareFlasher.cpp>
  -<network/OtaBootSwitch.cpp>
  -<network/OtaUpdater.cpp>
  -<platform/skip_efuse_blk_check.c>
build_flags =
  -std=gnu++2a
  !sdl2-config --cflags --libs
  -lssl
  -lcrypto
  -Wno-deprecated-declarations
  -Wno-narrowing
  -DSIMULATOR
  -DFREEINK_DEVICE_X4=1
  -DCROSSPOINT_SIMULATOR_PROJECT_WEBSERVER
  -DCROSSPOINT_VERSION=\"dev-simulator\"
  -DENABLE_SERIAL_LOG
  -DLOG_LEVEL=2
  -DEINK_DISPLAY_SINGLE_BUFFER_MODE=1
  -DMINIZ_NO_ZLIB_COMPATIBLE_NAMES=1
  -DXML_GE=0
  -DXML_CONTEXT_BYTES=1024
  -DUSE_UTF8_LONG_NAMES=1
  -DPNG_MAX_BUFFERED_PIXELS=16416
  -DDISABLE_FS_H_WARNING=1
  -DDESTRUCTOR_CLOSES_FILE=1
  -Isrc
lib_ignore = hal, PNGdec, JPEGDEC, WebSockets
extra_scripts =
  pre:scripts/gen_i18n.py
  pre:scripts/git_branch.py
  pre:scripts/build_html.py
  ; GCC 15 defaults C sources to C23, which breaks the C89-style QRCode
  ; library. Keep C files on C17 while C++ stays on -std=gnu++2a.
  pre:../../tools/sim/simulator_cflags.py
lib_deps =
  ; Symlink to the pinned submodule. Never replace with a git URL: that would
  ; build against upstream HEAD and invalidate the pin.
  simulator=symlink://../crosspoint-simulator
  FreeInkUI=symlink://freeink-sdk/libs/ui/FreeInkUI
  Icons=symlink://freeink-sdk/libs/assets/Icons
  bblanchon/ArduinoJson @ 7.4.2
  ricmoo/QRCode @ ^0.0.1
  https://github.com/bitbank2/AnimatedGIF.git#d01888f0255fd0781fc2b8600b9111b14c999584
  links2004/WebSockets @ 2.7.3
