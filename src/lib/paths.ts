export const siteHref = (file: string): string => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/${file}`;

export const cardHref = (id: string): string => siteHref(`#b-${id}`);

export const issueHref = (date?: string): string => siteHref(date === undefined ? "magazine/" : `magazine/${date}/`);

export const postLink = ({ id, url, onPage }: { id: string; url: string; onPage: boolean }) => ({
  "data-post-id": id,
  "data-post-url": url,
  ...(onPage ? { href: cardHref(id) } : { href: url, target: "_blank", rel: "noopener noreferrer" }),
});
