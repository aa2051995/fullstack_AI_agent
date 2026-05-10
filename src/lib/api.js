const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_token");
}

export function setToken(token) {
  if (typeof window === "undefined") return;
  localStorage.setItem("auth_token", token);
  document.cookie = `auth_token=${token}; path=/; max-age=${7 * 24 * 3600}; SameSite=Lax`;
}

export function clearToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("auth_token");
  document.cookie =
    "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      msg = err.detail || err.message || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const auth = {
  login: (email, password) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (email, password, username) =>
    request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, username }),
    }),

  me: () => request("/api/auth/me"),

  logout: () => request("/api/auth/logout", { method: "POST" }).catch(() => {}),
};

export const conversations = {
  list: () => request("/api/conversations"),

  create: (title = "New Chat") =>
    request("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  get: (id) => request(`/api/conversations/${id}`),

  delete: (id) => request(`/api/conversations/${id}`, { method: "DELETE" }),

  update: (id, data) =>
    request(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  async chat(conversationId, message, { onChunk, onDone, onError } = {}) {
    const token = getToken();
    try {
      const res = await fetch(
        `${API_URL}/api/conversations/${conversationId}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message }),
        },
      );

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const e = await res.json();
          msg = e.detail || e.message || msg;
        } catch (_) {}
        throw new Error(msg);
      }

      const contentType = res.headers.get("content-type") || "";

      // Non-streaming JSON fallback
      if (
        !contentType.includes("text/event-stream") &&
        !contentType.includes("text/plain")
      ) {
        const data = await res.json();
        const content = data.content || data.message || data.response || "";
        onChunk?.(content);
        onDone?.();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          onDone?.();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;

          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              onDone?.();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const chunk =
                parsed.content ??
                parsed.delta?.content ??
                parsed.choices?.[0]?.delta?.content ??
                parsed.text ??
                "";
              if (chunk) onChunk?.(chunk);
            } catch (_) {
              if (data) onChunk?.(data);
            }
          } else {
            onChunk?.(trimmed + "\n");
          }
        }
      }
    } catch (err) {
      onError?.(err);
    }
  },
};

export const configApi = {
  get: () => request("/api/config"),
  update: (data) =>
    request("/api/config", { method: "PATCH", body: JSON.stringify(data) }),
};
