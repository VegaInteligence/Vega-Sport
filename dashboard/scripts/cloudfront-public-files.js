// CloudFront viewer-request function. Restrict the private bucket to the same
// immutable public file paths accepted by the application's redirect.
function handler(event) {
  var request = event.request;
  var path = request.uri;
  var allowed =
    /^\/data\/(raw|computed|sources)\/[A-Za-z0-9_./-]+(?:-|\/)[a-f0-9]{24,64}\.(?:json(?:\.gz)?|webp|png|jpe?g)$/.test(
      path,
    );
  var hidden = path.split("/").some(function (part) {
    return part.charAt(0) === ".";
  });
  if (
    !allowed ||
    hidden ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return {
      statusCode: 403,
      statusDescription: "Forbidden",
      headers: { "cache-control": { value: "no-store" } },
    };
  }
  return request;
}
