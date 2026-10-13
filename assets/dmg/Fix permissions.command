#!/bin/bash
#
# Clears macOS's download flag from the installed copy of Office Space.
#
# Why this file exists: macOS marks anything that arrives through a browser
# with an extended attribute called `com.apple.quarantine`, and it lifts that
# mark by itself only for apps signed by Apple. Signing is a $99/year Apple
# Developer membership and this project has deliberately not bought one, so
# the mark stays and macOS reports a perfectly good app as damaged.
#
# `xattr -cr` removes extended attributes and nothing else. It does not touch
# code, settings, or anything outside the bundle it is pointed at, and it goes
# nowhere near the network. The whole of the work is the one line below; the
# rest of this file is saying what it found, so you are not asked to take that
# on trust.
#
# See INSTALL.txt beside this file, and docs/release.md in the repo.

set -u

APP="/Applications/Office Space.app"
FLAG="com.apple.quarantine"

printf '\n'
printf 'Office Space — clearing the macOS download flag\n'
printf '===============================================\n\n'

if [ ! -d "$APP" ]; then
  # The overwhelmingly likely reason somebody double-clicks this before it can
  # work: they ran it from the disk image without dragging the app across
  # first. Say that, rather than "no such file".
  printf 'Nothing to fix yet — Office Space is not in your Applications folder.\n\n'
  printf '  Looked for:  %s\n\n' "$APP"
  printf 'Drag Office Space onto the Applications folder in the disk image window,\n'
  printf 'then run this again.\n\n'
  printf 'If you deliberately put it somewhere else, open Terminal and run this\n'
  printf 'instead, with the path you actually used:\n\n'
  printf '    xattr -cr "/wherever/you/put/Office Space.app"\n\n'
  exit 1
fi

# Listed rather than tested with `xattr -p`, because `-p` exits non-zero both
# when the attribute is absent and when the command could not run at all, and
# those two are not the same answer.
if ! before=$(xattr "$APP" 2>&1); then
  printf 'Could not read the attributes on:\n\n  %s\n\n' "$APP"
  printf '%s\n\n' "$before"
  printf 'Nothing has been changed.\n\n'
  exit 1
fi

if printf '%s\n' "$before" | grep -q "$FLAG"; then
  printf 'BEFORE:  %s is flagged %s.\n' "$APP" "$FLAG"
  printf '         That is why macOS refused to open it.\n\n'
else
  printf 'BEFORE:  %s carries no %s flag.\n' "$APP" "$FLAG"
  printf '         Nothing was stopping it, but clearing again is harmless.\n\n'
fi

if ! output=$(xattr -cr "$APP" 2>&1); then
  printf 'Could not clear it:\n\n%s\n\n' "$output"
  printf 'If that says "Operation not permitted", the copy in Applications belongs\n'
  printf 'to another user. Delete it, drag your own copy across, and run this again.\n\n'
  exit 1
fi

if ! after=$(xattr "$APP" 2>&1); then
  printf 'Cleared it, but could not read the attributes back to confirm:\n\n%s\n\n' "$after"
  exit 1
fi

if printf '%s\n' "$after" | grep -q "$FLAG"; then
  # Should not happen, and if it does the honest answer is to say so rather
  # than print a success line the app will immediately contradict.
  printf 'AFTER:   the %s flag is STILL there.\n\n' "$FLAG"
  printf 'Something else is putting it back. Nothing here can fix that, and\n'
  printf 'Office Space will still refuse to open. Please report this.\n\n'
  exit 1
fi

printf 'AFTER:   the %s flag is gone.\n\n' "$FLAG"
printf 'Office Space will now open normally, from the Dock or from Applications,\n'
printf 'and will keep opening normally. You never need to run this again.\n\n'
printf 'You can close this window.\n\n'
