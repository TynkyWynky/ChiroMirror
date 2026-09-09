import type { Post } from "../types/content";

export function getPublishedPosts(posts: Post[], featuredOnly = false) {
  const timestamp = (post: Post) => Date.parse(post.eventDate || post.createdAt || "") || 0;

  return posts
    .filter((post) => post.published && (!featuredOnly || post.featured))
    .sort((left, right) =>
      Number(right.featured) - Number(left.featured) || timestamp(right) - timestamp(left)
    );
}

export function getPostPublishError(post: Post) {
  if (!post.title.trim()) {
    return "Geef je post eerst een titel voor je hem publiceert.";
  }

  if (!post.body.trim()) {
    return "Schrijf een bericht of voeg een afbeelding toe voor je publiceert.";
  }

  return null;
}
