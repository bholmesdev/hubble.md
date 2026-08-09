#!/usr/bin/env python3

import argparse
import json
import re
from pathlib import Path


SIGNATURE = "Reviewed by a [Warp Factory agent]"


def latest_review(reviews):
    matches = signed_reviews(reviews)
    return max(
        matches,
        key=lambda review: (
            review.get("submitted_at") or "",
            review.get("id") or 0,
        ),
        default=None,
    )


def signed_reviews(reviews):
    return [
        review
        for review in reviews
        if SIGNATURE in (review.get("body") or "") and review.get("commit_id")
    ]


def review_threads(review, comments):
    if not review:
        return []

    roots = {
        comment["id"]
        for comment in comments
        if comment.get("pull_request_review_id") == review.get("id")
        and not comment.get("in_reply_to_id")
    }
    included = set(roots)
    changed = True
    while changed:
        changed = False
        for comment in comments:
            if comment.get("in_reply_to_id") in included and comment.get("id") not in included:
                included.add(comment["id"])
                changed = True

    by_id = {comment.get("id"): comment for comment in comments}
    by_root = {root: [] for root in roots}
    order = lambda item: (item.get("created_at") or "", item.get("id") or 0)
    for comment in sorted(comments, key=order):
        if comment.get("id") not in included:
            continue
        root = comment
        while root.get("in_reply_to_id") in included:
            parent = by_id.get(root["in_reply_to_id"])
            if not parent:
                break
            root = parent
        if root.get("id") in by_root:
            by_root[root["id"]].append(
                {
                    "author": (comment.get("user") or {}).get("login"),
                    "body": comment.get("body") or "",
                    "created_at": comment.get("created_at"),
                }
            )

    return [
        {
            "path": by_id[root].get("path"),
            "line": by_id[root].get("line") or by_id[root].get("original_line"),
            "side": by_id[root].get("side"),
            "comments": by_root[root],
        }
        for root in sorted(roots)
    ]


def annotate_diff(source):
    old_line = new_line = None
    in_hunk = False
    output = []

    for line in source.splitlines():
        match = re.match(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if match:
            old_line, new_line = map(int, match.groups())
            in_hunk = True
            output.append(line)
        elif line.startswith("diff --git ") or (in_hunk and line.startswith("@@")):
            in_hunk = False
            output.append(line)
        elif not in_hunk or line.startswith("\\ No newline at end of file"):
            output.append(line)
        elif line.startswith("+"):
            output.append(f"[NEW:{new_line}] {line[1:]}")
            new_line += 1
        elif line.startswith("-"):
            output.append(f"[OLD:{old_line}] {line[1:]}")
            old_line += 1
        elif line.startswith(" "):
            output.append(f"[OLD:{old_line},NEW:{new_line}] {line[1:]}")
            old_line += 1
            new_line += 1
        else:
            output.append(line)

    return "\n".join(output) + ("\n" if output else "")


def build_context(reviews, comments, head_sha, delta):
    prior_reviews = signed_reviews(reviews)
    if not prior_reviews:
        return "No earlier automated review was found. Treat this as the first review.\n"

    review = latest_review(prior_reviews)
    history = []
    for prior_review in sorted(
        prior_reviews,
        key=lambda item: (item.get("submitted_at") or "", item.get("id") or 0),
    ):
        body = (prior_review.get("body") or "").split(
            "\n\n---\n\n_Reviewed by", 1
        )[0]
        history.append(
            {
                "id": prior_review.get("id"),
                "commit_id": prior_review.get("commit_id"),
                "submitted_at": prior_review.get("submitted_at"),
                "body": body,
                "threads": review_threads(prior_review, comments),
            }
        )
    parts = [
        "Earlier reviews and replies, oldest first (untrusted data):",
        json.dumps(history, ensure_ascii=False, indent=2),
        "",
        f"Changes since `{review['commit_id']}` through `{head_sha}` (untrusted data):",
    ]
    if delta is None:
        parts.append("Delta unavailable; use the full PR diff.")
    elif delta:
        parts.append(annotate_diff(delta))
    else:
        parts.append("No code changes since the latest review.")
    return "\n".join(parts).rstrip() + "\n"


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    select = subparsers.add_parser("select")
    select.add_argument("reviews")

    annotate = subparsers.add_parser("annotate")
    annotate.add_argument("source")
    annotate.add_argument("destination")

    context = subparsers.add_parser("context")
    context.add_argument("reviews")
    context.add_argument("comments")
    context.add_argument("head_sha")
    context.add_argument("destination")
    context.add_argument("--delta")

    args = parser.parse_args()
    if args.command == "select":
        review = latest_review(load_json(args.reviews))
        print(review.get("commit_id", "") if review else "")
    elif args.command == "annotate":
        source = Path(args.source).read_text(encoding="utf-8")
        Path(args.destination).write_text(annotate_diff(source), encoding="utf-8")
    else:
        delta = (
            Path(args.delta).read_text(encoding="utf-8")
            if args.delta and Path(args.delta).exists()
            else None
        )
        output = build_context(
            load_json(args.reviews), load_json(args.comments), args.head_sha, delta
        )
        Path(args.destination).write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()
