# Loading

```html
Page rendered
```

# Step 0
page }) => {
const url = new URL(page.url());
const response = await page.fetch(url.href, { method: "QUERY" });
assert.equal(
  response.status,
  404,
  "QUERY without a handler should not be served",
)

