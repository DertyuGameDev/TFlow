"""Chat labels are derived from the authenticated account, never a message."""


def chat_author(user):
    local = (user.email or "").strip().partition("@")[0]
    return local or (user.name or "").strip() or "Участник"
