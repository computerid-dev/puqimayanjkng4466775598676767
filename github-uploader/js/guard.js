(function () {
  const ALLOWED_HOSTS = ["nyr-githubuploader-v1.vercel.app"];
  if (!ALLOWED_HOSTS.includes(window.location.hostname)) window.location.replace("../index.html");
})();
