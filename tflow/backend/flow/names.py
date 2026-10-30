def split_name(value):
    """Keep legacy full names readable until their owner edits the two fields."""
    parts = value.strip().split(maxsplit=1)
    return (parts[0] if parts else "", parts[1] if len(parts) > 1 else "")


def full_name(first_name, last_name):
    return " ".join(part for part in (first_name.strip(), last_name.strip()) if part)
