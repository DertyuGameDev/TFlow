export function csrfToken() {
  return document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("csrftoken="))?.slice("csrftoken=".length) ?? "";
}

export const signInPath = () => `/login/?next=${encodeURIComponent("/" + window.location.hash)}`;
