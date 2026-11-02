"""Tolerant JSON loader for Minecraft files (allows // and /* */ comments and trailing commas)."""
import json
import re


def strip_comments(text):
    out, i, n = [], 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1]); i += 2; continue
            if c == '"':
                in_str = False
            i += 1; continue
        if c == '"':
            in_str = True; out.append(c); i += 1; continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i = text.find("*/", i + 2)
            i = n if i < 0 else i + 2
            continue
        out.append(c); i += 1
    return "".join(out)


def loads(text):
    text = strip_comments(text.lstrip("﻿"))
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return json.loads(text)


def load(path):
    with open(path, encoding="utf-8") as f:
        return loads(f.read())
