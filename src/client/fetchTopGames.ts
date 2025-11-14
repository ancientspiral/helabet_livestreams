export async function fetchTopGames() {
  const response = await fetch("/api/live/top-games", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}
