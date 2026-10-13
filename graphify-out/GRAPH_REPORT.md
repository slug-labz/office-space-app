# Graph Report - office-space  (2026-09-03)

## Corpus Check
- 441 files · ~748,975 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3876 nodes · 8292 edges · 228 communities (204 shown, 24 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 188 edges (avg confidence: 0.71)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e7233452`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Isometric Floor Rendering
- Allowed Bash Permissions
- Agent Source Browsing
- Staff Roster View
- Project Session Switcher
- Main Process IPC Handlers
- Office API Surface
- Office Floor View
- Hire & Skill Forms
- Capability & MCP Discovery
- DOM Element Helpers
- Approval Requests Queue
- MCP Connector Setup
- Renderer App Orchestration
- Choreographer
- Child Process Registry
- Claude Run Session Control
- Spotify OAuth & Token Crypto
- Manager Session
- Office Markdown Blocks
- Orphan Process Reaping
- Office Floorplan Layout
- Session Digest & Moments
- Settings View
- Dispatch Ledger Store
- Shipped File Reconciliation
- Spotify Client
- Aside Questions & Streaming
- App Panel Actions
- Agent Registry Store
- TypeScript Compiler Config
- Change Ledger & Undo
- Dials & Select Controls
- Permission Policy Notes
- Floor Click Interaction
- PR Review Notes
- Activity Feed Actions
- Speech Bubble Board
- Floorplan Amenities & Walking
- Speech Director
- Whisper Model Download
- Sprite Pixel Painter
- Chat Stream Blocks & Refusals
- Chat View
- Isometric Projection & Labels
- Denied Bash Commands
- Hired-From Provenance
- Activity Strip View
- Record Steps Panel
- Audit Findings Writeup
- Subagent Transcript Scan
- Sharing Disclosure Probe
- Agent Choreography Routines
- Markdown & Ask Cards
- Command Menu
- Approval Hook Notes
- Workspace Discovery Scan
- First-Run Gate & Instructions
- Token & Network Switch Store
- Allowed Process Spawn Test
- Task Parsing & Outcomes
- Sprite Sheet Slicing
- Campus Multi-Office View
- Unread Fields Checker
- Task List View
- Mishap Watching
- Colour Palette Theming
- Agent Activity State Model
- Character Recipe Generation
- Session Card Lifecycle
- Tile Grid Geometry
- Preload IPC Bridge
- Procedural Theme Registry
- Transcript Parsing
- DOM Test Helpers
- Task Verification Harness
- App Command Palette
- Preload IPC Bridge Tests
- Mock API Fixtures
- Floorplan Bounds Tests
- Hooks Report
- Skill Shelf Management
- Avatar Faces
- Merge Conflict Triage Notes
- PNG Encoding & Contact Sheet
- Preload Build Config
- Workspace Smoke Test CLI
- Project Directories
- Focus Management Helpers
- Project Room File Reader
- TypeScript Build Config
- Build & Ship Manifest
- Claude Binary Resolution
- Employee Work Log View
- Renderer Audio Playback
- Privacy Report View
- Approval Gate Hook Tests
- Electron Dev Dependencies
- Roster Hire & Fire
- First-Run Onboarding Panel
- Microphone Dictation Capture
- Data Store Privacy Measurement
- Conversation Length Bound Test
- Project Cost & Rows
- Floor Change Announcements
- Package Manifest Metadata
- Electron Builder Targets
- NPM Script Definitions
- Office Context Wrapping
- macOS Quarantine Check
- Approval Card Rendering
- Memory Cards
- Approval Summary Card
- Office Choreography Tests
- Status Line Composition
- Bridge Field Usage Checks
- Approval Gate Hook Script
- Workspace Settings and Hooks
- Auth and Billing Routes
- Music Player View
- Fuzzy Subsequence Matching
- Activity Restore & Delegation
- Plan Usage Warnings
- Permission Policy Checking
- Window Sizing Tests
- Workspace Root Resolution
- Roster and Problem Views
- Idle Clock and Scale
- Chat View Replay Tests
- CSS Control Class Proofs
- CSS Collision Checks
- Type Scale Enforcement
- Preflight Canary Checks
- Ambient Frame Gate
- Stuck Agent Nudges
- Project Status Plan
- Control Naming Test
- IPC Reader Coverage Test
- Panel Dialog Semantics Test
- Scenario Evaluation Harness
- Setup & Usage Docs
- Chat View Event Tests
- CSS Application Checks
- Element ID Consistency Test
- Panel Escape Test
- File Write and Symlink Safety
- Packaged File Whitelist
- macOS App Info Settings
- Unused Type Detection
- Workspace Standing Orders
- Module Test Coverage Check
- Live Region Test
- Project Session IPC Test
- Pop Menu Component
- Floor Trimming Test
- DMG Window Layout
- Dev Harness Server
- Capability Entry Point Test
- Motion Preference Test
- Source Text File Check
- Electron Dialog Tests
- Electron Keychain Stub
- Problem Snapshot Tests
- Redirect Loop Tests
- Office Floor Naming Tests
- Manager Identity Tests
- IPC Outcome Handling Tests
- Escape Handling Tests
- Hidden File Tests
- Interactive State Vocabularies
- Shippable Art Asset Checks
- Hooks View
- Badge And Panel Sync Tests
- Single Transcript Enforcement
- API Key Stripping Test
- Product Vision Doc
- Night 1 Handoff Notes
- Theme Pack Documentation
- Manager Agent Definition
- Release Build Configuration
- Office Harness Usage Guide
- Hook Discovery and Reporting
- Retracted Claims Log
- Session Switcher Groups
- Memory Keeper Agent
- Release Checklist
- Night 2 Review Findings
- Project README
- Explore Options Skill
- Plan Together Skill
- Night 1 Peer Brief
- Navigation Markup Proofs
- Single Panel List Test
- Write A Task Skill
- Project Plan Template
- Room Scene Drawing
- Backend Agent Definition
- Builder Agent Definition
- Frontend Agent Definition
- Reviewer Agent Definition
- Tester Agent Definition
- Meet Skill
- Record Progress Skill
- Authentication Setup Docs
- Roadmap Completed Items
- Branch Merge Plan
- Decision Record Skill
- Gotcha Record Skill
- Handoff Brief Skill
- Plan Writing Skill
- Verify Task Skill
- Licence Choice Review
- Packaged Artifact Runtime Check
- Project Tasks Template
- Project State Reconciliation
- Projects Directory Guide
- Pull Request Stacking Audit
- Approval Guard Cleanup Notes
- Unlanded Change Writeup
- Progress Log Template
- Merge Conflict Guard Notes
- Tooling Discovery Retrospective
- Night Two Merge Ordering
- Manual Driving Verification Notes
- Truncated Panel List Bug
- Probe Correction Sweep Notes

## God Nodes (most connected - your core abstractions)
1. `registerHandlers()` - 111 edges
2. `El` - 103 edges
3. `FloorView` - 85 edges
4. `allow` - 84 edges
5. `OfficeApi` - 77 edges
6. `installDom()` - 57 edges
7. `ChatView` - 30 edges
8. `mountMusic()` - 30 edges
9. `mountSwitcher()` - 29 edges
10. `_permissions_comment` - 27 edges

## Surprising Connections (you probably didn't know these)
- `workspace()` --indirect_call--> `body()`  [INFERRED]
  test/capabilities.test.ts → src/renderer/chat-view.ts
- `workspace()` --indirect_call--> `body()`  [INFERRED]
  test/commands.test.ts → src/renderer/chat-view.ts
- `workspace()` --indirect_call--> `body()`  [INFERRED]
  test/permissions.test.ts → src/renderer/chat-view.ts
- `workspace()` --indirect_call--> `body()`  [INFERRED]
  test/workspace.test.ts → src/renderer/chat-view.ts
- `refusalBlock()` --indirect_call--> `call()`  [INFERRED]
  src/renderer/views/refusal.ts → test/nudge.test.ts

## Import Cycles
- None detected.

## Communities (228 total, 24 thin omitted)

### Community 0 - "Isometric Floor Rendering"
Cohesion: 0.07
Nodes (82): FACE_OF, OUTCOME_COLOUR, WALK_CYCLE, Anchor, applyRoomPalette(), boxFaces, BoxSpec, ChairOptions (+74 more)

### Community 1 - "Allowed Bash Permissions"
Cohesion: 0.02
Nodes (84): allow, Bash(basename:*), Bash(bun add:*), Bash(bun install:*), Bash(bun run:*), Bash(bun -v), Bash(cat:*), Bash(cut:*) (+76 more)

### Community 2 - "Agent Source Browsing"
Cohesion: 0.16
Nodes (22): browseSource(), checkOnThem(), CLAUDE_AGENTS, digest(), firstLine(), groupBySource(), hireFrom(), isProvenance() (+14 more)

### Community 3 - "Staff Roster View"
Cohesion: 0.11
Nodes (32): el(), fireButton(), personRow(), renderRoster(), RosterHandlers, shelfSection(), skillRow(), staffSection() (+24 more)

### Community 4 - "Project Session Switcher"
Cohesion: 0.11
Nodes (21): el(), mountSwitcher(), newProjectRow(), Switcher, SwitcherHandlers, SwitcherModel, SessionInfo, narrow() (+13 more)

### Community 5 - "Main Process IPC Handlers"
Cohesion: 0.07
Nodes (53): activePack(), addressed(), APP_ROOT, asSession(), autoDecided, byId(), CLAUDE_SETTINGS, controls (+45 more)

### Community 7 - "Office Floor View"
Cohesion: 0.08
Nodes (6): FloorView, screenOf(), tileOf(), lookKey(), Workstation, RoomReading

### Community 8 - "Hire & Skill Forms"
Cohesion: 0.18
Nodes (20): buttons(), COMMON_TOOLS, el(), field(), FormHandlers, HireDraft, hireForm(), input() (+12 more)

### Community 9 - "Capability & MCP Discovery"
Cohesion: 0.07
Nodes (36): CapabilityOptions, describe(), isRecord(), keysOf(), McpScope, McpServer, McpSource, McpSurvey (+28 more)

### Community 10 - "DOM Element Helpers"
Cohesion: 0.05
Nodes (13): Zone, click(), dataStore(), El, splitTop(), text(), blocks(), one() (+5 more)

### Community 11 - "Approval Requests Queue"
Cohesion: 0.10
Nodes (16): ApprovalRequest, beat(), decide(), Decided, DIR, missedCount(), pending(), triageAgainst() (+8 more)

### Community 12 - "MCP Connector Setup"
Cohesion: 0.09
Nodes (31): connect(), disconnect(), Existing, projectServers(), readConfig(), removeConnector(), writeConnector(), writes (+23 more)

### Community 13 - "Renderer App Orchestration"
Cohesion: 0.05
Nodes (59): activityBySession, appActions(), approvals, art, busyProjects, closeChanged(), closeConnectors(), closeFirstRun() (+51 more)

### Community 15 - "Child Process Registry"
Cohesion: 0.12
Nodes (21): Admission, admit(), Child, live, liveChildren(), liveCount(), register(), Registered (+13 more)

### Community 16 - "Claude Run Session Control"
Cohesion: 0.11
Nodes (26): buildArgs(), RunHandle, RunOptions, RunSummary, initialControls(), refusalCause(), withCauses(), argsFor() (+18 more)

### Community 17 - "Spotify OAuth & Token Crypto"
Cohesion: 0.10
Nodes (23): RFC-7636, connect(), ConnectResult, exchange(), listen(), waitForCode(), blobFor(), Crypt (+15 more)

### Community 18 - "Manager Session"
Cohesion: 0.13
Nodes (11): ManagerSession, SessionOptions, ModeChange, changeIsForHere(), modeAnnouncement(), modeChrome, isMode(), Mode (+3 more)

### Community 19 - "Office Markdown Blocks"
Cohesion: 0.13
Nodes (17): ConnectorLine, HEADINGS, OFFICE_HEADINGS, officeBlocks(), OfficeState, outstandingBody(), RoomLine, SkillLine (+9 more)

### Community 20 - "Orphan Process Reaping"
Cohesion: 0.13
Nodes (25): forget(), forgetHere(), load(), pathOf(), Reaped, reapOrphans(), recordOrphansIn(), remember() (+17 more)

### Community 21 - "Office Floorplan Layout"
Cohesion: 0.08
Nodes (30): BENCH_X, benchSeat(), block(), COFFEE, CRATES, hashName(), MEETING_ROOM, MEETING_TABLE (+22 more)

### Community 22 - "Session Digest & Moments"
Cohesion: 0.10
Nodes (13): digest(), DIGEST_PROMPT, DigestRequest, firstLine(), isSilence(), Moment, MomentKind, MomentRecorder (+5 more)

### Community 23 - "Settings View"
Cohesion: 0.11
Nodes (28): applySettings(), Choice, orderColumns(), readSettings(), renderSettings(), row(), SettingsHandlers, themeIds() (+20 more)

### Community 24 - "Dispatch Ledger Store"
Cohesion: 0.13
Nodes (26): append(), appendOne(), appends, asDispatch(), asOutcome(), asString(), dispatchesIn(), EMPTY_LEDGER (+18 more)

### Community 25 - "Shipped File Reconciliation"
Cohesion: 0.16
Nodes (20): bringShippedFilesForward(), ALWAYS_NAMED, ApplyOutcome, applyReconcile(), byPath(), describe(), hashOf(), isDisabledInPlace() (+12 more)

### Community 26 - "Spotify Client"
Cohesion: 0.12
Nodes (13): Deps, pickImage(), reason(), Spotify, SpotifyDevice, SpotifyImage, SpotifyPlayback, SpotifyTrack (+5 more)

### Community 27 - "Aside Questions & Streaming"
Cohesion: 0.14
Nodes (21): track(), AsideAnswer, AsideRequest, askAside(), askStatus(), STATUS_QUESTION, statusQuestionFor(), runClaude() (+13 more)

### Community 28 - "App Panel Actions"
Cohesion: 0.13
Nodes (20): confirmDelete(), decide(), hireFromThere(), onlyPanel(), removeConnector(), say(), setVoice(), showConnectors() (+12 more)

### Community 29 - "Agent Registry Store"
Cohesion: 0.15
Nodes (18): openRegistry(), writeRegistry(), writeRegistryQueue, isRecord(), loadRegistry(), mayWriteRegistry(), mergeNewest(), parseRegistry() (+10 more)

### Community 30 - "TypeScript Compiler Config"
Cohesion: 0.07
Nodes (27): node, src/renderer/**, test/**/*.ts, compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib (+19 more)

### Community 31 - "Change Ledger & Undo"
Cohesion: 0.05
Nodes (62): About, DIR, listChanges(), markUndone(), pathOf(), readAbout(), readChanges(), recordChanges() (+54 more)

### Community 32 - "Dials & Select Controls"
Cohesion: 0.12
Nodes (20): built, chosen, Dial, DialElements, DIALS, fillDials(), Key, showControls() (+12 more)

### Community 33 - "Permission Policy Notes"
Cohesion: 0.07
Nodes (27): _permissions_comment, a permission prompt: anything not pre-authorised is simply refused, and the agent finds, and `pip install`, and for the same reason., believed, and every task carries a VERIFY condition \u2014 which is a command. An office that, cannot run commands cannot verify anything, so its central rule quietly becomes a wish., `curl localhost` cannot be allowed on its own: rules match by prefix and the `:` in, deletes anything, or publishes anything. Adding your project's test command is expected;, exact command, and you decide. A local check is one click; anything reaching off this (+19 more)

### Community 34 - "Floor Click Interaction"
Cohesion: 0.10
Nodes (13): FloorCallbacks, SpriteSheet, Rig, SHEET, STAFF, Rig, SHEET, floor() (+5 more)

### Community 35 - "PR Review Notes"
Cohesion: 0.07
Nodes (26): #170, in an order somebody can review, ★ Pass 1 — Things the office said that were not true (13 commits), ★ Pass 2 — Data the office could lose (5 commits), ★ Pass 3 — The window had no error handling at all (6 commits), ★ Pass 4 — The keyboard (7 commits), The rest, by subject, What to be suspicious of, #166 — A check nobody could ask to run · **merge** (+18 more)

### Community 36 - "Activity Feed Actions"
Cohesion: 0.14
Nodes (17): activityFor(), actOnUnfinished(), drawStrip(), feed(), firstLine(), openCard(), refreshUnfinished(), resize() (+9 more)

### Community 37 - "Speech Bubble Board"
Cohesion: 0.10
Nodes (12): Scene, Bubble, BubbleBoard, BubbleState, checkedLine(), doingLine(), situationKey(), Reason (+4 more)

### Community 38 - "Floorplan Amenities & Walking"
Cohesion: 0.17
Nodes (13): Amenities, Floorplan, Lounge, Pantry, Spot, Direction, distance(), Pixel (+5 more)

### Community 39 - "Speech Director"
Cohesion: 0.10
Nodes (9): DirectorState, Speaker, SpeechDirector, systemSpeaker(), Urgency, Utterance, WebSpeechSynthesis, WebUtterance (+1 more)

### Community 40 - "Whisper Model Download"
Cohesion: 0.11
Nodes (26): BREW_PATHS, clean(), cores(), DOWNLOAD_HOSTS, DOWNLOAD_SUFFIXES, DownloadPolicy, fetchModel(), findBrew() (+18 more)

### Community 41 - "Sprite Pixel Painter"
Cohesion: 0.14
Nodes (17): bobFor(), BODY_DOWN, BODY_FOR, BODY_RIGHT, BODY_UP, Buffer, CharacterSheet, GLYPHS (+9 more)

### Community 42 - "Chat Stream Blocks & Refusals"
Cohesion: 0.10
Nodes (26): StreamBlock, ToolDenial, decisionLine(), announcesItself(), assertNever(), clamp(), flatten(), markFor() (+18 more)

### Community 43 - "Chat View"
Cohesion: 0.24
Nodes (7): appendTo(), block(), body(), ChatView, render(), summarise(), Panel

### Community 44 - "Isometric Projection & Labels"
Cohesion: 0.21
Nodes (13): ellipsise(), labelWidthFor(), Measure, Box, chooseScale(), corners, depthAt(), depthOf() (+5 more)

### Community 45 - "Denied Bash Commands"
Cohesion: 0.09
Nodes (23): deny, Bash(bash:*), Bash(chmod:*), Bash(claude:*), Bash(dd:*), Bash(diskutil:*), Bash(eval:*), Bash(git checkout:*) (+15 more)

### Community 46 - "Hired-From Provenance"
Cohesion: 0.16
Nodes (20): kindFrom(), renderMaintained(), renderRefusal(), toneOf(), whereFrom(), Found, Provenance, saidPlainly() (+12 more)

### Community 47 - "Activity Strip View"
Cohesion: 0.16
Nodes (23): Dispatch, TornLine, ActivityHandlers, clock(), el(), needsYou(), neverReported(), nowRunning() (+15 more)

### Community 48 - "Record Steps Panel"
Cohesion: 0.14
Nodes (6): mountRecord(), Record, Ledger, Step, ledger(), rig()

### Community 49 - "Audit Findings Writeup"
Cohesion: 0.07
Nodes (27): §4, employees somebody else maintains — holds, including the hard case, §5, the memory agent — one real defect, §6, connectors — holds, including the part that matters, Built, and then actually driven, Closed by enumeration rather than by the next one biting, Decision #2, built, One that was reported as outstanding and is not, Outstanding, and not ours to close (+19 more)

### Community 50 - "Subagent Transcript Scan"
Cohesion: 0.17
Nodes (14): latestFor(), parseMeta(), scanSubagents(), SubagentRun, SubagentScan, encodeCwd(), isFile(), Located (+6 more)

### Community 51 - "Sharing Disclosure Probe"
Cohesion: 0.17
Nodes (18): askAbout(), firstLine(), isRepository(), run, SharingRow, whatWouldBeShared(), sharingSection(), Asked (+10 more)

### Community 52 - "Agent Choreography Routines"
Cohesion: 0.10
Nodes (16): asString(), attendeesFrom(), ChoreographyOptions, EMPTY, EventLike, factsFromEvent(), Pose, Priority (+8 more)

### Community 53 - "Markdown & Ask Cards"
Cohesion: 0.19
Nodes (12): askCard(), buttonFor(), inline(), isItem(), renderMarkdown(), Ask, AskCard, AskOption (+4 more)

### Community 54 - "Command Menu"
Cohesion: 0.19
Nodes (10): CommandMenu, CommandMenuHandlers, Invocable, filterItems(), slashToken(), item(), ITEMS, Rig (+2 more)

### Community 55 - "Approval Hook Notes"
Cohesion: 0.10
Nodes (20): _hooks_comment, 133 lines in approvals.ts that wait on it, and a panel. Nothing registered it, so PreToolUse, answers itself with the rule, and only *unlisted* becomes a question. That is the case the, call'. It could not. test/repo-health.test.ts now fails if a hook file is never registered., child_process, never through the CLI. They do not pass this hook at all., everything would ask a person about reading a file., gate is for - `claude --print` cannot stop and ask, so an unlisted command is simply refused, green test suite throughout. CLAUDE.md meanwhile told every agent the gate 'can refuse a tool (+12 more)

### Community 56 - "Workspace Discovery Scan"
Cohesion: 0.11
Nodes (28): Capabilities, collect(), Command, CommandScan, discoverCommands(), readCommand(), ProjectScan, AgentFile (+20 more)

### Community 57 - "First-Run Gate & Instructions"
Cohesion: 0.11
Nodes (18): Instructions, readGate(), readInstructions(), readOr(), FirstRunState, firstRunVerdict, isBlocked(), Severity (+10 more)

### Community 58 - "Token & Network Switch Store"
Cohesion: 0.16
Nodes (14): readSwitch(), writeSwitch(), canRemember(), clientIdPath(), networkAllowed(), readClientId(), setNetworkAllowed(), switchPath() (+6 more)

### Community 59 - "Allowed Process Spawn Test"
Cohesion: 0.33
Nodes (6): NOT_STOPPED_AT_QUIT, repo, RUN_A_FIXED_BINARY, RUN_WHAT_THEY_ARE_GIVEN, sources(), spawners()

### Community 60 - "Task Parsing & Outcomes"
Cohesion: 0.19
Nodes (17): refreshOutcomes(), cells(), checkable(), Checked, commandIn(), HEADINGS, isBarePath(), isPlaceholder() (+9 more)

### Community 61 - "Sprite Sheet Slicing"
Cohesion: 0.18
Nodes (12): fromPixels(), fromSheet(), toBitmaps(), PAINT_DIRECTIONS, fits(), FrameRect, frameRects(), sheetIndexFor() (+4 more)

### Community 62 - "Campus Multi-Office View"
Cohesion: 0.18
Nodes (17): CampusCard, CampusOffice, campusSize(), canvasCeiling(), cardAt(), CardSize, columnsFor(), fitCampus() (+9 more)

### Community 63 - "Unread Fields Checker"
Cohesion: 0.12
Nodes (16): broken, bump(), cfg, cfgPath, checker, collectFrom(), dead, declarationsOf() (+8 more)

### Community 64 - "Task List View"
Cohesion: 0.13
Nodes (15): TaskReport, Check, renderTaskList(), TaskHandlers, taskRow(), buttons(), firstRunTree(), host() (+7 more)

### Community 65 - "Mishap Watching"
Cohesion: 0.20
Nodes (11): MishapSource, reasonOf(), watchForMishaps(), describeMishap(), keyOf(), Mishap, MishapLog, Report (+3 more)

### Community 66 - "Colour Palette Theming"
Cohesion: 0.15
Nodes (21): applyPalette(), channels(), contrast(), cssVariables(), DEFAULT_PALETTE, GRAPHITE, hex(), legibleOn() (+13 more)

### Community 67 - "Agent Activity State Model"
Cohesion: 0.20
Nodes (13): applyFact(), collapse(), EMPTY_ACTIVITY, EntryKind, InFlight, Pending, push(), quietNote() (+5 more)

### Community 68 - "Character Recipe Generation"
Cohesion: 0.13
Nodes (14): ACCESSORIES, Accessory, HAIR, HAIR_STYLES, HairStyle, hash(), OUTLINE, pick() (+6 more)

### Community 69 - "Session Card Lifecycle"
Cohesion: 0.13
Nodes (29): addTemplate(), closeCard(), current(), dropStrandedTabs(), firstRunState(), moveMode(), nobodyHere(), openCurrent() (+21 more)

### Community 70 - "Tile Grid Geometry"
Cohesion: 0.19
Nodes (11): directionFromDelta(), DIRECTIONS, NEIGHBOUR_OFFSETS, pixelToTile(), tileKey(), tilesEqual(), WalkGrid, findPath() (+3 more)

### Community 71 - "Preload IPC Bridge"
Cohesion: 0.10
Nodes (22): Egress, api, on(), onPlain(), AsideResult, CHANNEL, ControlsResult, CreatedProject (+14 more)

### Community 72 - "Procedural Theme Registry"
Cohesion: 0.18
Nodes (13): Cast, PaintDirection, proceduralTheme, fail(), scanThemes(), ThemeDescriptor, THEMES_DIR, ThemeScan (+5 more)

### Community 73 - "Transcript Parsing"
Cohesion: 0.14
Nodes (13): asCommand(), Base, ContentBlock, NON_CONVERSATIONAL, ParseOptions, parseTranscript(), resultToText(), TextBlock (+5 more)

### Community 74 - "DOM Test Helpers"
Cohesion: 0.09
Nodes (15): base(), dispatch(), Panel, readFile(), ToolEntry, cssName(), documentListeners, FakeCustomEvent (+7 more)

### Community 75 - "Task Verification Harness"
Cohesion: 0.15
Nodes (16): allVerified(), checkProject(), HarnessOptions, readTasks(), TaskCheck, Verdict, clamp(), killTree() (+8 more)

### Community 76 - "App Command Palette"
Cohesion: 0.32
Nodes (5): closeEverything(), AppPalette, PaletteHost, Action, Harness

### Community 77 - "Preload IPC Bridge Tests"
Cohesion: 0.18
Nodes (9): handled, invoked, main, missing(), preload, pushed, root, subscribed (+1 more)

### Community 78 - "Mock API Fixtures"
Cohesion: 0.16
Nodes (14): api, assistantText(), currentSession, emit(), listeners, scripted(), SESSIONS, SNAPSHOT (+6 more)

### Community 79 - "Floorplan Bounds Tests"
Cohesion: 0.09
Nodes (11): Surface, nothingRan(), whyNothingRan(), Recorder, ROSTERS, record(), Recorder, underside() (+3 more)

### Community 80 - "Hooks Report"
Cohesion: 0.13
Nodes (18): buildReport(), EVENTS, fileNamedBy(), Hook, HookFile, hooksLede(), HookSource, isRecord() (+10 more)

### Community 81 - "Skill Shelf Management"
Cohesion: 0.20
Nodes (14): addSkill(), describe(), isValidSkillId(), NewSkill, removeSkill(), shelfReport(), skillFile(), SkillResult (+6 more)

### Community 82 - "Avatar Faces"
Cohesion: 0.22
Nodes (9): avatar(), AvatarSource, faceOf(), faces, forgetFaces(), Rig, Call, sheet() (+1 more)

### Community 83 - "Merge Conflict Triage Notes"
Cohesion: 0.08
Nodes (24): 2026-08-28 — the pile re-measured, and all three conflicts resolved in rehearsal, Bucket 1 — merge on green, Bucket 2 — needs a human judgement, Bucket 3 — governance, not fixes, Claims in this repository that were later retracted, `eval.ts` — complementary, and the conflict is only the import line, `main.ts` imports `electron` at module scope, and that is where the bugs are, `PLAN.md` — left for the owner, with the fact it turns on (+16 more)

### Community 84 - "PNG Encoding & Contact Sheet"
Cohesion: 0.17
Nodes (12): BG, big, canvas, paintSheet(), chunk(), crc32(), CRC_TABLE, encodePng() (+4 more)

### Community 85 - "Preload Build Config"
Cohesion: 0.13
Nodes (14): src/preload/**, compilerOptions, lib, noEmit, outDir, rootDir, sourceMap, exclude (+6 more)

### Community 86 - "Workspace Smoke Test CLI"
Cohesion: 0.14
Nodes (9): args, asJson, cleanup(), killTree(), panel, project, ROOT, state (+1 more)

### Community 87 - "Project Directories"
Cohesion: 0.23
Nodes (11): Created, createProject(), discoverProjects(), displayName(), exists(), linksIn(), Project, PROJECT_FILES (+3 more)

### Community 88 - "Focus Management Helpers"
Cohesion: 0.60
Nodes (3): canTakeFocus(), firstFocusable(), Focusable

### Community 89 - "Project Room File Reader"
Cohesion: 0.24
Nodes (13): CONVENTION, healthOf(), linesOn(), notesOn(), Reading, readRoom(), RoomSources, TaskSummary (+5 more)

### Community 90 - "TypeScript Build Config"
Cohesion: 0.14
Nodes (13): src/main/**/*.ts, src/preload/**/*.ts, src/renderer/**/*.ts, src/shared/**/*.ts, compilerOptions, lib, exclude, extends (+5 more)

### Community 91 - "Build & Ship Manifest"
Cohesion: 0.12
Nodes (9): manifestPath, root, seededFiles(), SHIPPED, repo, run, LICENCE_TEXT_SAYS, root (+1 more)

### Community 92 - "Claude Binary Resolution"
Cohesion: 0.22
Nodes (10): binaryNames(), Found, installedLocations(), isRunnable(), missingMessage(), resolveClaude(), ResolveOptions, SYSTEM_LOCATIONS (+2 more)

### Community 93 - "Employee Work Log View"
Cohesion: 0.31
Nodes (4): renderWorkLog(), summariseWork(), EmployeeWork, render()

### Community 94 - "Renderer Audio Playback"
Cohesion: 0.20
Nodes (7): DRIFT_S, Stereo, VOICES, Call, Fake, fakeAudio(), param()

### Community 95 - "Privacy Report View"
Cohesion: 0.16
Nodes (21): PrivacyReport, egressSection(), el(), forgetButton(), PrivacyHandlers, promptSection(), renderPrivacy(), storeRow() (+13 more)

### Community 96 - "Approval Gate Hook Tests"
Cohesion: 0.15
Nodes (5): answer(), base(), DIR, Ended, HOOK

### Community 97 - "Electron Dev Dependencies"
Cohesion: 0.15
Nodes (13): electron, electron-builder, esbuild, devDependencies, electron, electron-builder, esbuild, tsx (+5 more)

### Community 98 - "Roster Hire & Fire"
Cohesion: 0.21
Nodes (17): agentFile(), describe(), disable(), disabled(), enable(), exists(), fire(), hire (+9 more)

### Community 99 - "First-Run Onboarding Panel"
Cohesion: 0.27
Nodes (9): badge(), commandRow(), el(), FirstRunHandlers, label(), renderFirstRun(), stepCard(), Step (+1 more)

### Community 100 - "Microphone Dictation Capture"
Cohesion: 0.14
Nodes (21): MicElements, MicHandlers, State, wireMic(), Dictated, DictationSetup, encodeWav(), hasSpeech() (+13 more)

### Community 101 - "Data Store Privacy Measurement"
Cohesion: 0.14
Nodes (16): Store, STORES, template(), warnBeforeDeleting(), yours(), forget(), ForgetOutcome, measure() (+8 more)

### Community 102 - "Conversation Length Bound Test"
Cohesion: 0.83
Nodes (3): base(), conversation(), nodesAfter()

### Community 103 - "Project Cost & Rows"
Cohesion: 0.16
Nodes (19): costLabel(), money(), ProjectInfo, ago(), chats(), metaFor(), NewAction, NewActionRow (+11 more)

### Community 104 - "Floor Change Announcements"
Cohesion: 0.20
Nodes (9): Fact, Unstaged, FACT, MUTATORS, OFFICE, OUTCOMES, park(), pending() (+1 more)

### Community 105 - "Package Manifest Metadata"
Cohesion: 0.18
Nodes (10): author, description, engines, node, license, main, name, private (+2 more)

### Community 106 - "Electron Builder Targets"
Cohesion: 0.18
Nodes (11): build, appId, copyright, directories, extraResources, linux, productName, buildResources (+3 more)

### Community 107 - "NPM Script Definitions"
Cohesion: 0.18
Nodes (11): scripts, build, coverage, discover, dist, eval, harness, package (+3 more)

### Community 109 - "macOS Quarantine Check"
Cohesion: 0.31
Nodes (9): checkQuarantine(), appQuarantine(), bundlePath(), Quarantine, quarantineMessage(), run, bundle(), inBundle() (+1 more)

### Community 110 - "Approval Card Rendering"
Cohesion: 0.32
Nodes (4): draw(), host(), model(), quiet

### Community 111 - "Memory Cards"
Cohesion: 0.18
Nodes (16): NOT_A_MEMORY, readMemory(), card(), GROUPS, metaOf(), renderMemory(), date(), frontmatter() (+8 more)

### Community 112 - "Approval Summary Card"
Cohesion: 0.18
Nodes (14): approvalCard(), aboutTheClock(), ApprovalSummary, blockedBy(), cut(), HEADLINE, inAnswerOrder(), NETWORK (+6 more)

### Community 113 - "Office Choreography Tests"
Cohesion: 0.20
Nodes (6): insideOffice(), stationsByName(), DISPATCH, ROSTER_12, runnerFor(), STAFF

### Community 114 - "Status Line Composition"
Cohesion: 0.40
Nodes (8): composerInvite(), CountedProblem, nobodyListening(), shelfPart(), staffPart(), statusLine(), unreadableUnder(), clean

### Community 115 - "Bridge Field Usage Checks"
Cohesion: 0.21
Nodes (10): line(), bridgeFields(), bridgeModules(), FORMAT_MODULES, NO_READER_NEEDED, uses(), workspace(), workspace() (+2 more)

### Community 116 - "Approval Gate Hook Script"
Cohesion: 0.33
Nodes (9): allow(), asked, cleanup(), defer(), deny(), main(), missed(), WAIT_MS (+1 more)

### Community 117 - "Workspace Settings and Hooks"
Cohesion: 0.20
Nodes (9): _comment, hooks, PreToolUse, permissions, $schema, Enforcement (who may delegate, budget ceilings) lives in the app, not here., Office Space workspace settings., read-only observability \u2014 none returns a decision, none can block a tool call. (+1 more)

### Community 118 - "Auth and Billing Routes"
Cohesion: 0.29
Nodes (8): Billing, billingRoute(), billingWarning(), isOn(), Redirect, REDIRECTS, Shadow, checkBilling()

### Community 119 - "Music Player View"
Cohesion: 0.07
Nodes (38): el(), mountMusic(), Music, MusicBridge, MusicHandlers, MusicCommand, MusicConnection, MusicSetup (+30 more)

### Community 120 - "Fuzzy Subsequence Matching"
Cohesion: 0.27
Nodes (7): accelerator(), byGroup(), filterActions(), matchIn(), subsequenceStart(), ACTIONS, settle()

### Community 121 - "Activity Restore & Delegation"
Cohesion: 0.16
Nodes (13): Activity, applyNote(), EMPTY, Entry, endsHere(), restoreActivity(), RestoredActivity, DELEGATION_TOOLS (+5 more)

### Community 122 - "Plan Usage Warnings"
Cohesion: 0.36
Nodes (7): billing(), label(), percent(), PlanUsage, planWarning(), resetsIn(), base

### Community 123 - "Permission Policy Checking"
Cohesion: 0.16
Nodes (18): triage, checkPolicy(), asRules(), bashRule(), chainsCommands(), EMPTY_POLICY, judge(), Policy (+10 more)

### Community 124 - "Window Sizing Tests"
Cohesion: 0.42
Nodes (7): archiveProject(), deleteProject(), describeProject(), isSafeProjectId(), ProjectContents, RemovalOutcome, Trash

### Community 125 - "Workspace Root Resolution"
Cohesion: 0.31
Nodes (6): addProjectTemplate(), Contents, contentsOf(), ResolvedRoot, resolveWorkspaceRoot(), RootOptions

### Community 126 - "Roster and Problem Views"
Cohesion: 0.18
Nodes (9): crowding(), loadCommands(), openForm(), paintRoster(), refreshRoster(), rosterWrite(), showRoster(), describeProblem() (+1 more)

### Community 127 - "Idle Clock and Scale"
Cohesion: 0.31
Nodes (7): Beats, beatsAt(), idleDraws(), chatView, floorView, panels, root

### Community 128 - "Chat View Replay Tests"
Cohesion: 0.39
Nodes (8): base(), inFlight(), Panel, ran(), replied(), said(), settledTool(), thought()

### Community 129 - "CSS Control Class Proofs"
Cohesion: 0.28
Nodes (6): CONTROL_CLASSES, css(), declaredClasses(), root, SHEETS, stripComments()

### Community 130 - "CSS Collision Checks"
Cohesion: 0.25
Nodes (4): read(), root, SHEETS, topLevel()

### Community 131 - "Type Scale Enforcement"
Cohesion: 0.25
Nodes (7): declarations(), RADIUS_LITERALS, root, SCALE, SHEETS, SIZE_LITERALS, stripComments()

### Community 132 - "Preflight Canary Checks"
Cohesion: 0.25
Nodes (5): ahead, base, CANARIES, head, ROOT

### Community 133 - "Ambient Frame Gate"
Cohesion: 0.14
Nodes (8): AmbientOptions, fractionOf(), FrameGate, idleFor(), idle(), ROSTER, runLikeTheApp(), runLikeTheTests()

### Community 134 - "Stuck Agent Nudges"
Cohesion: 0.31
Nodes (7): nudge(), Nudge, nudgeFor(), Waiting, whoIsStuck(), call(), none

### Community 135 - "Project Status Plan"
Cohesion: 0.11
Nodes (18): 0. Status board, 1. The thesis, 2. The decisive architectural call — corrected 2026-08-19, 3. What is built, 4a. Fixed on 2026-08-19 — the first outside review, 4b. The visual system — started 2026-08-19, 5. Decisions, 5a. Why the office is pointed at nothing — 2026-08-19 (+10 more)

### Community 136 - "Control Naming Test"
Cohesion: 0.36
Nodes (6): Control, has(), html, named(), skipped(), spoken()

### Community 137 - "IPC Reader Coverage Test"
Cohesion: 0.29
Nodes (5): consumerFiles(), NO_READER_NEEDED, reached(), root, sources()

### Community 138 - "Panel Dialog Semantics Test"
Cohesion: 0.29
Nodes (5): app, coveringPanelIds(), elementIds(), html, root

### Community 139 - "Scenario Evaluation Harness"
Cohesion: 0.23
Nodes (11): main(), Outcome, runOne(), Scenario, SCENARIOS, Expectation, Observed, offRoster() (+3 more)

### Community 140 - "Setup & Usage Docs"
Cohesion: 0.15
Nodes (8): If you have Flow API access, Setting up, Sources, Talking to the office, The office talking back, The part that is actually hard, Voice, When it stays quiet

### Community 142 - "CSS Application Checks"
Cohesion: 0.33
Nodes (4): COMPUTED, LEGACY_PSEUDO_ELEMENTS, renderer, specificity()

### Community 143 - "Element ID Consistency Test"
Cohesion: 0.29
Nodes (5): html, inMarkup, lookedUp, referenced, root

### Community 144 - "Panel Escape Test"
Cohesion: 0.33
Nodes (3): covering, NOT_ASKED_FOR, repo

### Community 145 - "File Write and Symlink Safety"
Cohesion: 0.38
Nodes (5): FOLLOWS_AND_UNUSED, fsImportsIn(), importersOf(), repo, sourceFiles()

### Community 146 - "Packaged File Whitelist"
Cohesion: 0.33
Nodes (5): files, dist/**/*, !dist/**/*.map, !dist/renderer/dev.html, !dist/renderer/mock.js

### Community 147 - "macOS App Info Settings"
Cohesion: 0.33
Nodes (6): mac, NSMicrophoneUsageDescription, category, extendInfo, identity, target

### Community 148 - "Unused Type Detection"
Cohesion: 0.47
Nodes (4): ROOT, shown(), SRC_DIR, unusedTypes()

### Community 149 - "Workspace Standing Orders"
Cohesion: 0.18
Nodes (10): 1. Only two principals may originate work, 2. Claims are verified, not believed, 3. Nothing on screen may lie, 4. Absent is not empty, graphify, Layout, Office Space, The project convention (+2 more)

### Community 150 - "Module Test Coverage Check"
Cohesion: 0.40
Nodes (5): aimedAt(), NO_EXPORTS, NO_TEST_AIMS_AT, repo, tsFiles()

### Community 151 - "Live Region Test"
Cohesion: 0.33
Nodes (3): app, html, root

### Community 152 - "Project Session IPC Test"
Cohesion: 0.33
Nodes (4): app, firstParameter, ipc, root

### Community 153 - "Pop Menu Component"
Cohesion: 0.43
Nodes (4): mountPopMenu(), PopMenu, Rig, documentEvent()

### Community 154 - "Floor Trimming Test"
Cohesion: 0.33
Nodes (3): campus, office, root

### Community 155 - "DMG Window Layout"
Cohesion: 0.40
Nodes (5): dmg, contents, window, height, width

### Community 156 - "Dev Harness Server"
Cohesion: 0.40
Nodes (4): port, root, server, TYPES

### Community 161 - "Motion Preference Test"
Cohesion: 0.50
Nodes (4): movingRules(), root, Rule, strip()

### Community 162 - "Source Text File Check"
Cohesion: 0.50
Nodes (4): ALLOWED, NOT_OURS, root, textFiles()

### Community 165 - "Electron Keychain Stub"
Cohesion: 0.50
Nodes (3): app, keychain, safeStorage

### Community 166 - "Problem Snapshot Tests"
Cohesion: 0.67
Nodes (3): main, problemsArray(), withoutComments()

### Community 168 - "Office Floor Naming Tests"
Cohesion: 0.50
Nodes (3): avatar, html, root

### Community 175 - "Hooks View"
Cohesion: 0.28
Nodes (15): card(), classFor(), eventHeading(), groupByEvent(), inertCard(), metaOf(), nothingRegistered(), originOf() (+7 more)

### Community 179 - "Product Vision Doc"
Cohesion: 0.12
Nodes (16): 10. Open questions, 1. The one-sentence thesis, 2. Backend = a Claude Code workspace, 3.1 Project tabs (top), 3.2 The office floor (centre), 3.3 Chat panel (right), 3.4 Agent speech bubbles (from Cadre), 3. Frontend — the office (+8 more)

### Community 180 - "Night 1 Handoff Notes"
Cohesion: 0.13
Nodes (14): Deliberately not read, Going back to symptoms that were explained rather than fixed, Named, not fixed, Night 1 — what landed, and the one thing that did not, Phase two, examined, Shipped, Surfaces driven, and what was found to be right, The dictation claim, traced end to end (+6 more)

### Community 181 - "Theme Pack Documentation"
Cohesion: 0.14
Nodes (12): Themes — your own art goes here, 1. Buy it, 2. Drop it in, 3. Write the manifest, 4. Restart, Installing a pack, Starting in a particular theme, Switching back (+4 more)

### Community 182 - "Manager Agent Definition"
Cohesion: 0.14
Nodes (13): Asking, in intake, Choosing who does the work, Keeping the project current, Reporting, Running commands: one per call, never chained, Sizing the work: decompose, then choose a model per part, Talking to the user, The dispatch contract (+5 more)

### Community 183 - "Release Build Configuration"
Cohesion: 0.14
Nodes (14): And the app says it too, once, `dmg.contents` — where the install card goes, and why not the other two places, `extraResources` — the template, and only the template, `files` — what goes inside the archive, `mac.identity: null` — ad-hoc signing, on purpose, macOS: it is not signed, and here is exactly what that costs, Releasing Office Space, The build config, annotated (+6 more)

### Community 184 - "Office Harness Usage Guide"
Cohesion: 0.15
Nodes (13): Checks, Does the manager actually delegate?, Driving it, and three ways to be wrong about what you see, If the office says it cannot find `claude`, If you want to point at a specific `claude`, Running it, The roster is the workspace, Trust the workspace, or the office cannot run anything (+5 more)

### Community 185 - "Hook Discovery and Reporting"
Cohesion: 0.26
Nodes (11): abbreviate(), isDocumentation(), manifestKey(), message(), originOf(), readHookFiles(), readHooks(), readSource() (+3 more)

### Community 186 - "Retracted Claims Log"
Cohesion: 0.17
Nodes (11): `activeElement === document.body` means focus fell through, Claims this branch made and later took back, `.claude/launch.json` reaches a stranger's workspace by two paths, `SessionInfo.updatedAt` is when the conversation was last active, The campus regime where the cap matters, The campus reserves its note-row so the note fits under the ceiling, The floor's overflow is trimmed evenly, The shared pop menu behaves like the switcher's `+` menu (+3 more)

### Community 187 - "Session Switcher Groups"
Cohesion: 0.40
Nodes (4): model(), mounted(), quiet, Session

### Community 189 - "Memory Keeper Agent"
Cohesion: 0.20
Nodes (8): Boundaries, Job 1 — Record, Job 2 — Report, The rooms, Your report is now the whole of what is seen, Memory, The shape, What belongs here

### Community 190 - "Release Checklist"
Cohesion: 0.20
Nodes (8): 1. It builds and it is honest about itself, 2. Nothing personal is in the artifact, 3. It runs on a machine that has never seen the repo, 4. It does what it says, 5. It does not lie when things go wrong, 6. What it costs is visible, The release checklist, What is deliberately not on this list

### Community 191 - "Night 2 Review Findings"
Cohesion: 0.20
Nodes (10): Checks that matched text rather than meaning, Night 2 — five more, one root cause each, Rounds 3 and 4 — the declared list, and a regression of my own, Rounds 5 and 6 — where a fix was worse than the code it replaced, Still open, Tests that were wrong before they were right, The pattern worth keeping, The shape that keeps recurring (+2 more)

### Community 192 - "Project README"
Cohesion: 0.20
Nodes (10): Add an agent, a desk appears, Art, Docs, If you downloaded the DMG instead, Licence, Office Space, The four rules, Where the ideas came from (+2 more)

### Community 193 - "Explore Options Skill"
Cohesion: 0.22
Nodes (8): Converging, Diverging, Exploring options, The frames are the whole mechanism, and they belong to the field, The shape, What to write down, When not to use this, Yes, this fans out. `plan-together` forbids that. Both are right.

### Community 194 - "Plan Together Skill"
Cohesion: 0.22
Nodes (8): One at a time. Never fan out., Planning together, The document is the channel, The shape, What each of them is for, What this skill does not do, When to stop, You sign it

### Community 195 - "Night 1 Peer Brief"
Cohesion: 0.22
Nodes (8): Freeze, Half one — build S6 and S7, Half two — be the adversary, Night 1 — brief for the second session, Rules for both of us, The eight streams, The situation, Your job, in two halves

### Community 196 - "Navigation Markup Proofs"
Cohesion: 0.22
Nodes (5): switcherLabel(), app, html, root, view

### Community 197 - "Single Panel List Test"
Cohesion: 0.29
Nodes (6): app, bodyOf(), Entry, html, root, table()

### Community 198 - "Write A Task Skill"
Cohesion: 0.29
Nodes (6): Choosing the command, Moving a task, Owner, The VERIFY column is a command, not a verdict, When it genuinely cannot be a command, Writing a task

### Community 199 - "Project Plan Template"
Cohesion: 0.29
Nodes (6): Constraints, Done looks like, Out of scope, <Project Name>, What we are building, Why

### Community 201 - "Backend Agent Definition"
Cohesion: 0.33
Nodes (5): Boundaries, How you work, The rooms, Verifying, Your report is now the whole of what is seen

### Community 202 - "Builder Agent Definition"
Cohesion: 0.33
Nodes (5): Boundaries, How you work, Reporting back, The rooms, Your report is now the whole of what is seen

### Community 203 - "Frontend Agent Definition"
Cohesion: 0.33
Nodes (5): Boundaries, How you work, The rooms, Verifying, Your report is now the whole of what is seen

### Community 204 - "Reviewer Agent Definition"
Cohesion: 0.33
Nodes (5): Boundaries, How to report, The rooms, What to look for, in priority order, Your report is now the whole of what is seen

### Community 205 - "Tester Agent Definition"
Cohesion: 0.33
Nodes (5): Boundaries, Reporting, The rooms, What you do, Your report is now the whole of what is seen

### Community 206 - "Meet Skill"
Cohesion: 0.33
Nodes (5): Calling a meeting, How to call it, What it does not do, When not to call one, Why it is a skill and not a sentence

### Community 207 - "Record Progress Skill"
Cohesion: 0.33
Nodes (5): Evidence, Recording progress, The shape, What belongs in it, What does not

### Community 208 - "Authentication Setup Docs"
Cohesion: 0.33
Nodes (6): Authentication, Setting up, The one trap worth knowing, What this means in practice, What we do not support, and why, Why it works this way

### Community 209 - "Roadmap Completed Items"
Cohesion: 0.33
Nodes (6): 4. Next, ~~A. More than one session per project~~ — done 2026-08-19, ~~B. The harness on the floor~~ — done 2026-08-19, ~~C. The skills shelf~~ — done 2026-08-19, ~~D. File-based themes~~ — done 2026-08-19, ~~E. Decide the hook feed's fate~~ — settled: deleted

### Community 210 - "Branch Merge Plan"
Cohesion: 0.33
Nodes (5): Four files collide, and only because branches append to the same place, Merging the twenty-two, Resolving them, Two are stacked, and merging them out of order makes work, What the result should be

### Community 212 - "Decision Record Skill"
Cohesion: 0.40
Nodes (4): Record the decision, What does not belong, What makes it worth keeping, Where it goes

### Community 213 - "Gotcha Record Skill"
Cohesion: 0.40
Nodes (4): Record the gotcha, Three things, and the last one is the point, Where it goes, Worth recording even when it was your own mistake

### Community 214 - "Handoff Brief Skill"
Cohesion: 0.40
Nodes (4): Hand it over, Say what you did not check, What the brief contains, Where it goes

### Community 215 - "Plan Writing Skill"
Cohesion: 0.40
Nodes (4): Out of scope earns its section, Revising rather than starting again, The sections, and the only difficult one, Write the plan

### Community 216 - "Verify Task Skill"
Cohesion: 0.40
Nodes (4): Afterwards, Check the claim, The outcomes, and what each one means, What to do

### Community 217 - "Licence Choice Review"
Cohesion: 0.40
Nodes (5): The licence question, The one thing that is not a code question, What is in here, verified, What the choice actually changed here, What was actually done

### Community 218 - "Packaged Artifact Runtime Check"
Cohesion: 0.40
Nodes (5): And the sizes a person can actually reach, The app was run, and that is what found the last one, The packaged artifact, opened, What running it still cannot answer, What the real runtime confirmed that nothing else could

### Community 219 - "Project Tasks Template"
Cohesion: 0.40
Nodes (4): Done, In progress, Queued, Tasks — <Project Name>

### Community 220 - "Project State Reconciliation"
Cohesion: 0.50
Nodes (3): Establish, then write, What is actually true right now, What must not happen

### Community 221 - "Projects Directory Guide"
Cohesion: 0.50
Nodes (3): Projects, Starting one, The three files

### Community 223 - "Pull Request Stacking Audit"
Cohesion: 0.67
Nodes (3): All 44 PRs, composed — measured rather than assumed, Order does not fix it, What is already stacked, and needs no resolution

### Community 224 - "Approval Guard Cleanup Notes"
Cohesion: 0.67
Nodes (3): Asked and clean, The clearance that was handed to a corpse, What the new guard cost to get right

### Community 225 - "Unlanded Change Writeup"
Cohesion: 0.67
Nodes (3): The one thing that did not land, To land it, Why it is not committed

## Knowledge Gaps
- **1146 isolated node(s):** `root`, `html`, `app`, `asked`, `WAIT_MS` (+1141 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FloorView` connect `Office Floor View` to `Isometric Floor Rendering`, `Floor Click Interaction`, `Staff Roster View`, `Speech Bubble Board`, `Floorplan Amenities & Walking`, `Tile Grid Geometry`, `Room Scene Drawing`, `Floor Change Announcements`, `DOM Test Helpers`, `Isometric Projection & Labels`, `Renderer App Orchestration`, `Office Floorplan Layout`, `Campus Multi-Office View`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `El` connect `DOM Element Helpers` to `Chat View Replay Tests`, `Staff Roster View`, `Project Session Switcher`, `Hire & Skill Forms`, `MCP Connector Setup`, `Chat View Event Tests`, `Settings View`, `Pop Menu Component`, `Change Ledger & Undo`, `Dials & Select Controls`, `Floor Click Interaction`, `Chat Stream Blocks & Refusals`, `Chat View`, `Hired-From Provenance`, `Activity Strip View`, `Record Steps Panel`, `Command Menu`, `Session Switcher Groups`, `Task List View`, `DOM Test Helpers`, `Task Verification Harness`, `App Command Palette`, `Hooks Report`, `Avatar Faces`, `Employee Work Log View`, `Notice Panel Turn Tests`, `Privacy Report View`, `First-Run Onboarding Panel`, `Microphone Dictation Capture`, `Conversation Length Bound Test`, `Approval Card Rendering`, `Memory Cards`, `Music Player View`, `Fuzzy Subsequence Matching`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `StaffMember` connect `Staff Roster View` to `Isometric Floor Rendering`, `Floor Click Interaction`, `Main Process IPC Handlers`, `Office Floor View`, `Preload IPC Bridge`, `Hire & Skill Forms`, `Child Process Registry`, `Claude Run Session Control`, `Manager Session`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `registerHandlers()` (e.g. with `message()` and `record()`) actually correct?**
  _`registerHandlers()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `root`, `html`, `app` to the rest of the system?**
  _1146 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Isometric Floor Rendering` be split into smaller, more focused modules?**
  _Cohesion score 0.06739811912225706 - nodes in this community are weakly interconnected._
- **Should `Allowed Bash Permissions` be split into smaller, more focused modules?**
  _Cohesion score 0.023809523809523808 - nodes in this community are weakly interconnected._