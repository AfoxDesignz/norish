# 28: Foods kept distinct before this release are never asked

**What to build:** Found by ticket 12, for Mike to decide. AI asks only foods no person decided about, and a food kept distinct counts as decided. On the production copy, 114 own foods are kept distinct after the first start, most of them marked by hand under 0.25 to silence a flag. They include the spec's junk cases "deegroller", "melted" and toilet paper. So with AI on they stay exactly as they are, and the spec's Problem Statement is not fixed for them.

Options: leave it (a person's mark stands); or ask AI once, at the first start, about foods kept distinct before this release.

**Blocked by:** None

**Status:** ready-for-agent

- [x] Mike's call is recorded here.
- [ ] The upgrade clears every Keep distinct mark made before this release, so AI asks those foods once.
- [ ] The Upgrade notes say so.
- [ ] All `CONTRIBUTING.md` gates pass.

Mike, 2026-10-21: "remove everything i marked distinct so we get a fresh look". A mark made after the upgrade stands as today.
