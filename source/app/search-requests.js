function createSearchRequests() {
  let keyword = '';
  let page = 1;
  let current;

  function reset(nextKeyword) {
    current?.controller.abort();
    current = undefined;
    keyword = nextKeyword;
    page = 1;
  }

  return {
    reset,
    start() {
      if (!keyword || current) return;
      current = { keyword, page, controller: new AbortController() };
      return current;
    },
    isCurrent(request) { return current === request; },
    advance(request) { if (current === request) page++; },
    finish(request) { if (current === request) current = undefined; },
  };
}
