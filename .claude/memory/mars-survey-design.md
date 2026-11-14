---
name: mars-survey-design
description: "HaLow planner UI was redesigned (2026-11-14) to a \"Mars survey\" style from design idea/ image; design canvas artifact exists"
metadata:
  node_type: memory
  type: project
  originSessionId: b1b6df02-ecac-436e-af83-19a461356840
  modified: 2026-11-14T15:53:53.534Z
---

On 2026-11-14 the user had the whole HaLow Relay Planner UI redesigned to match a reference image in `design idea/` (dark map poster with contour lines, glowing route, ringed markers, hairline panels), recoloured to Mars. They approved the design canvas first (https://claude.ai/artifact/7STooyUaUWScDRF7ec2cFe), then asked for it implemented "exactly", verified with Chrome DevTools MCP, and run on localhost:5173.

**Why:** they want the app to feel like a field survey map, and want old rivers and walkable routes shown on the terrain.

**How to apply:** keep new UI work in this language (tokens in styles.css / theme.ts). Show design changes as an artifact before implementing. Verify in the browser, not just with tests.
