// Legacy-host redirector. The directory moved from directory.meandmybadself.com
// to directory.eisenhower.school; this Worker owns the old hostname and 301s
// every request to the new one, preserving path, query and hash-free URL shape.
//
// Path preservation matters: magic-link emails sent before the move point at
// /auth/callback?token=… on the old host, and those links must keep working.
const TARGET_HOST = "directory.eisenhower.school";

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.hostname = TARGET_HOST;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  },
};
