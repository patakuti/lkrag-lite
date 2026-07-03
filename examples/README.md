# Sample Workspace — "Aurora Hub" Project Notes

A small, fictional set of project notes for demoing **lkrag-lite**. It simulates the
kind of personal/team knowledge base lkrag-lite is built for: scattered Markdown
notes — a project overview, a product spec, meeting minutes, a roadmap, a decision
log, a glossary, and a known-issues list — living in a plain folder, edited
directly, never "uploaded" anywhere.

All content is fictional (a made-up smart home hub product) and for demonstration
purposes only.

## How to use this for a demo

1. Point a new lkrag-lite workspace at this folder.
2. Click **Update** to build the index.
3. Try asking things like:
   - "What's the target retail price and why was that number chosen?"
   - "Why did the team decide not to include a battery?"
   - "What changed about the setup flow, and why?"
   - "Who owns QA, and what issues are they currently tracking?"
   - "Is voice assistant support coming in v1.0?"
   - "What's the risk to the Q4 launch date?"

   Several of these require pulling facts from **two or more files** (e.g. the
   battery question spans the kickoff notes, the design review notes, and the
   decision log) — good for showing off hybrid search + multi-file citations.

4. Then edit a file to show live re-indexing — for example, open
   `07-known-issues.md` and change ISSUE-022's status, or bump a date in
   `04-roadmap.md`. Click **Update** again and ask the same question — the
   answer reflects the edit immediately, with no re-upload step.

## File guide

| File | Contents |
|---|---|
| `00-project-overview.md` | Product summary, team, target specs |
| `01-product-spec.md` | Frozen v1.0 hardware/software spec |
| `02-meeting-notes-2026-05-12-kickoff.md` | Kickoff: scope, pricing, ownership |
| `03-meeting-notes-2026-06-03-design-review.md` | Design review: setup flow rework, battery decision |
| `04-roadmap.md` | Milestones and schedule risks |
| `05-decision-log.md` | Numbered decisions (DEC-###) referenced from other files |
| `06-glossary.md` | Internal terminology |
| `07-known-issues.md` | Open/resolved bugs and risks (ISSUE-###) |
