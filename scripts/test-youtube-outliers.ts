import assert from "node:assert/strict";
import { cleanSubtitles, formatFrom, normalizeApifyYouTubeItem, parseDurationSeconds, parsePublishDate, youtubeVideoId } from "../src/lib/youtube-outliers/parse";
import { channelSummary, rankOutliers, scoreOutliers } from "../src/lib/youtube-outliers/scoring";
import { channelListingInput, channelStartUrl, subtitlesInput } from "../src/lib/youtube-outliers/source-apify";
import { buildYouTubeIdeaPrompt, youtubeSourceFacts } from "../src/lib/youtube-outliers/ideas";
import { richLong } from "../src/lib/youtube-outliers/notion";
import { YT_OUTLIER_PROPERTIES } from "../src/lib/youtube-outliers/schema";
import { estimateCost } from "../src/lib/instagram-brain/cost";
import type { YouTubeFormat, YouTubeVideo } from "../src/lib/youtube-outliers/types";

const now = new Date("2026-11-17T13:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

// --- parsing ---
assert.equal(parseDurationSeconds("00:03:17"), 197);
assert.equal(parseDurationSeconds("29:54"), 1794);
assert.equal(parseDurationSeconds("PT14M35S"), 875);
assert.equal(parseDurationSeconds("PT1H2M"), 3720);
assert.equal(parseDurationSeconds(875), 875);
assert.equal(parseDurationSeconds(""), 0);
assert.equal(parseDurationSeconds("abc"), 0);

assert.deepEqual(parsePublishDate("20261114", now), { iso: "2026-11-14T00:00:00.000Z", approximate: false });
assert.equal(parsePublishDate("2026-11-14", now).approximate, false);
const rel = parsePublishDate("3 weeks ago", now);
assert.equal(rel.approximate, true);
assert.equal(Math.round((now.getTime() - Date.parse(rel.iso)) / 86_400_000), 21);
assert.equal(parsePublishDate("Streamed 2 days ago", now).approximate, true);
assert.deepEqual(parsePublishDate("", now), { iso: "", approximate: false });
assert.deepEqual(parsePublishDate("not a date", now), { iso: "", approximate: false });

assert.equal(cleanSubtitles("1\n00:00:01,000 --> 00:00:02,000\nHello there\n\n2\n00:00:02,000 --> 00:00:03,000\nHello there\nworld"), "Hello there world");
assert.equal(cleanSubtitles("WEBVTT\nKind: captions\nLanguage: en\n\n00:00.000 --> 00:01.000\n<c>hi</c> you"), "hi you");

assert.equal(formatFrom({ url: "https://www.youtube.com/shorts/abc", durationSeconds: 30 }), "Short");
assert.equal(formatFrom({ url: "https://www.youtube.com/watch?v=abc", durationSeconds: 900 }), "Long-form");
assert.equal(formatFrom({ url: "https://www.youtube.com/watch?v=abc", durationSeconds: 45 }), "Short"); // duration fallback
assert.equal(formatFrom({ url: "https://www.youtube.com/watch?v=abc", durationSeconds: 45, fromUrl: "https://www.youtube.com/@x/videos" }), "Long-form"); // tab wins
assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=FJZkfjM8WhI&t=3"), "FJZkfjM8WhI");
assert.equal(youtubeVideoId("https://youtube.com/shorts/wWd4FtyfjWM"), "wWd4FtyfjWM");

const item = normalizeApifyYouTubeItem({
  id: "FJZkfjM8WhI", title: "T", url: "https://www.youtube.com/watch?v=FJZkfjM8WhI", viewCount: "260,286", likes: "1.2K",
  duration: "15:21", date: "2026-11-07", channelName: "kaye.creatives", fromYTUrl: "https://www.youtube.com/@Kaye.creates/videos",
  subtitles: [{ srt: "1\n00:00:01,000 --> 00:00:02,000\nhey" }],
}, now);
assert.equal(item.views, 260_286);
assert.equal(item.likes, 1_200);
assert.equal(item.comments, null);
assert.equal(item.durationSeconds, 921);
assert.equal(item.format, "Long-form");
assert.equal(item.transcript, "hey");
assert.equal(item.publishedAt, "2026-11-07T00:00:00.000Z");

// --- Apify inputs: never the paid speech-to-text fallback ---
assert.equal(channelStartUrl("@Kaye.creates"), "https://www.youtube.com/@Kaye.creates");
assert.equal(channelStartUrl("https://www.youtube.com/@Kaye.creates/videos/"), "https://www.youtube.com/@Kaye.creates");
assert.equal(channelStartUrl("UCDHy_qf3CJ8azlfbJKEGIHw"), "https://www.youtube.com/channel/UCDHy_qf3CJ8azlfbJKEGIHw");
const listing = channelListingInput("@Kaye.creates", 30, 30);
assert.equal(listing.transcriptionAndSubtitle, "NONE");
assert.equal(listing.maxResultStreams, 0);
assert.equal(listing.sortVideosBy, "NEWEST");
assert.equal(subtitlesInput(["u1", "u2"]).transcriptionAndSubtitle, "ALWAYS_SUBTITLES");
assert.equal(subtitlesInput(["u1", "u2"]).maxResults, 2);
assert.equal(estimateCost("apify-youtube-video", 60), 0.24);
assert.equal(estimateCost("youtube-data-api"), 0);

// --- scoring ---
let n = 0;
const v = (format: YouTubeFormat, ageDays: number, views: number, extra: Partial<YouTubeVideo> = {}): YouTubeVideo => ({
  id: `v${++n}`, url: `https://www.youtube.com/watch?v=v${n}`, title: `video ${n}`, description: "", format,
  durationSeconds: format === "Short" ? 30 : 900, views, likes: null, comments: null, publishedAt: daysAgo(ageDays),
  approximateDate: false, channelName: "c", channelUrl: "", transcript: "", ...extra,
});

// Long-form channel: views grow ~ sqrt(age) around 100k at 25 days. Shorts sit at ~4k. Formats must not mix.
const growth = (age: number, level: number) => Math.round(level * Math.sqrt(age / 25));
const longs = [5, 10, 15, 20, 30, 40, 50, 70, 90, 120].map((age) => v("Long-form", age, growth(age, 100_000)));
const shorts = [2, 4, 6, 8, 12, 16, 20, 25].map((age) => v("Short", age, growth(age, 4_000)));
const hitLong = v("Long-form", 30, growth(30, 100_000) * 5, { title: "hit long" }); // 5x
const hitShort = v("Short", 10, growth(10, 4_000) * 3, { title: "hit short" }); // 3x
const oldBig = v("Long-form", 300, growth(300, 100_000), { title: "old normal" }); // big lifetime views, but normal for its age
const brandNew = v("Long-form", 0.3, 400_000, { title: "too new" });
const scored = scoreOutliers([...longs, ...shorts, hitLong, hitShort, oldBig, brandNew], { now });
const by = (title: string) => scored.find((video) => video.title === title)!;

assert.ok(by("hit long").score.isOutlier, "5x long-form is an outlier");
assert.ok(Math.abs((by("hit long").score.multiple ?? 0) - 5) < 1.2, `hit long multiple ≈5 (got ${by("hit long").score.multiple})`);
assert.equal(by("hit long").score.baselineMethod, "age-curve");
assert.ok(by("hit short").score.isOutlier, "3x Short is an outlier against Shorts only");
assert.ok(Math.abs((by("hit short").score.multiple ?? 0) - 3) < 0.9, `hit short multiple ≈3 (got ${by("hit short").score.multiple})`);
// A Short compared with long-form would look like 0.04x; same-format baseline keeps it fair.
assert.ok((by("hit short").score.expectedViews ?? 0) < 20_000);
// Age-fair: an old video with huge lifetime views is ~1x, not an outlier (and outside the window anyway).
assert.ok(Math.abs((by("old normal").score.multiple ?? 0) - 1) < 0.35, `old normal ≈1x (got ${by("old normal").score.multiple})`);
assert.equal(by("old normal").score.isOutlier, false);
assert.match(by("too new").score.reason, /too new/);
assert.equal(by("too new").score.isOutlier, false);
// Normal videos aren't flagged.
assert.equal(scored.filter((video) => video.score.isOutlier).length, 2);
assert.deepEqual(rankOutliers(scored).map((video) => video.title), ["hit long", "hit short"]);

// Leave-one-out: the hit doesn't raise its own bar (expected ≈ normal curve at 30 days ≈ 110k).
assert.ok((by("hit long").score.expectedViews ?? 0) < 140_000);

// Too few peers → never flagged.
const tiny = scoreOutliers([v("Short", 5, 1000), v("Short", 6, 1000), v("Short", 7, 90_000)], { now });
assert.ok(tiny.every((video) => !video.score.isOutlier && video.score.baselineMethod === "insufficient"));

// View floor and window.
const floorSet = scoreOutliers([...[3, 5, 7, 9, 11, 13].map((age) => v("Short", age, 200)), v("Short", 8, 1_500, { title: "small hit" })], { now });
assert.match(floorSet.find((video) => video.title === "small hit")!.score.reason, /floor/);
const windowSet = scoreOutliers([...shorts, v("Short", 45, 200_000, { title: "old short hit" })], { now });
assert.match(windowSet.find((video) => video.title === "old short hit")!.score.reason, /window/);
// No date → never scored.
assert.equal(scoreOutliers([...shorts, v("Short", 1, 1, { publishedAt: "", title: "undated" })], { now }).find((x) => x.title === "undated")!.score.reason, "no publish date");
// Duplicate ids (same video from two tabs) collapse to one.
const dup = v("Short", 3, 5_000);
assert.equal(scoreOutliers([...shorts, dup, { ...dup, views: 6_000 }], { now }).filter((x) => x.id === dup.id).length, 1);

const summary = channelSummary(scored);
assert.equal(summary.Short.videos, 9);
assert.equal(summary["Long-form"].outliers, 1);

// --- idea prompt ---
const prompt = buildYouTubeIdeaPrompt(by("hit long"), 3);
assert.match(prompt, /Create 3 original Instagram Reel ideas/);
assert.match(prompt, /x normal/);
assert.match(prompt, /No transcript/);
assert.match(prompt, /Visual Storyteller/);
assert.match(youtubeSourceFacts({ ...by("hit long"), transcript: "abc" }), /Transcript excerpt: abc/);

// --- Notion helpers (no network) ---
assert.equal(richLong("x".repeat(4_500)).length, 3);
assert.equal(richLong("").length, 0);
assert.ok(YT_OUTLIER_PROPERTIES.Video.title, "title property is Video");

console.log("youtube-outliers tests passed");
