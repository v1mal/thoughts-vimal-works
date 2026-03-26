#!/usr/bin/env python3
import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def infer_history_rows(payload):
    if isinstance(payload, list):
        return payload

    if isinstance(payload, dict):
        for key in ("rows", "data", "items", "records"):
            value = payload.get(key)
            if isinstance(value, list):
                return value

    raise ValueError("Unsupported history export shape. Expected a list or an object containing rows/data/items/records.")


def canonical_history_status(value):
    mapping = {
        "published": "approved",
        "approved": "approved",
        "pending": "pending",
        "rejected": "rejected",
        "hidden": "hidden",
    }
    return mapping.get((value or "").lower(), "rejected")


def generated_history_id(row):
    text = row.get("text", "").strip()
    created_at = row.get("created_at", "")
    seed = row.get("seed", "")
    digest = hashlib.sha1(f"{text}|{created_at}|{seed}".encode("utf-8")).hexdigest()[:12]
    stamp = "".join(character for character in created_at if character.isdigit())[:14] or "history"
    return f"hist-{stamp}-{digest}"


def merge_row(existing, incoming):
    for key, value in incoming.items():
        if existing.get(key) in (None, "", []) and value not in (None, "", []):
            existing[key] = value
    return existing


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def build_archive_rows(payload):
    thoughts = payload.get("thoughts", [])
    rows = {}

    for thought in thoughts:
        thought_id = thought["id"]
        rows[thought_id] = {
            "id": thought_id,
            "text_original": thought["text"],
            "text_published": None,
            "status": "approved",
            "timestamp_ist": thought["timestamp"],
            "seed": None,
            "score": None,
            "reason": None,
            "suggestion": None,
            "round": None,
            "source": "archive_backfill",
            "created_at": thought["timestamp"],
            "updated_at": thought["timestamp"],
            "approved_at": thought["timestamp"],
            "approved_by_email": None,
            "hidden_at": None,
        }

    return rows


def enrich_with_history(rows, history_rows):
    by_text = {row["text_original"]: row for row in rows.values()}

    for record in history_rows:
        text = (record.get("text") or "").strip()
        if not text:
            continue

        status = canonical_history_status(record.get("status"))
        created_at = record.get("created_at") or now_iso()
        matched = by_text.get(text)

        incoming = {
            "text_original": text,
            "text_published": None,
            "status": status,
            "timestamp_ist": record.get("timestamp_ist") or record.get("timestamp") or created_at,
            "seed": record.get("seed"),
            "score": record.get("score"),
            "reason": record.get("reason"),
            "suggestion": record.get("suggestion"),
            "round": record.get("round"),
            "source": "n8n_history_backfill",
            "created_at": created_at,
            "updated_at": created_at,
            "approved_at": created_at if status == "approved" else None,
            "approved_by_email": None,
            "hidden_at": created_at if status == "hidden" else None,
        }

        if matched:
            merge_row(matched, incoming)
            if matched["status"] != "approved":
                matched["status"] = status
            continue

        generated_id = record.get("id") or generated_history_id(record)
        rows[generated_id] = {
            "id": generated_id,
            **incoming,
        }

    return rows


def post_rows(supabase_url, service_role_key, rows):
    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/thoughts?on_conflict=id"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(rows).encode("utf-8"),
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8") or "[]")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase backfill failed: {error.code} {body}") from error


def main():
    parser = argparse.ArgumentParser(description="Backfill Thoughts rows into Supabase.")
    parser.add_argument("--supabase-url", required=True, help="Supabase project URL")
    parser.add_argument("--service-role-key", required=True, help="Supabase service role key")
    parser.add_argument(
        "--archive",
        default="data/thoughts.json",
        help="Path to the current public archive JSON",
    )
    parser.add_argument(
        "--history",
        help="Optional path to an exported n8n thoughts history JSON payload",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=100,
        help="Rows per upsert request",
    )
    args = parser.parse_args()

    archive_path = Path(args.archive)
    if not archive_path.exists():
        print(f"Archive file not found: {archive_path}", file=sys.stderr)
        raise SystemExit(1)

    rows = build_archive_rows(load_json(archive_path))

    if args.history:
        history_payload = load_json(Path(args.history))
        enrich_with_history(rows, infer_history_rows(history_payload))

    ordered_rows = list(rows.values())
    total_written = 0

    for start in range(0, len(ordered_rows), args.chunk_size):
        chunk = ordered_rows[start : start + args.chunk_size]
        response_rows = post_rows(args.supabase_url, args.service_role_key, chunk)
        total_written += len(response_rows)

    print(f"Backfill completed. Upserted {total_written} rows.")


if __name__ == "__main__":
    main()
