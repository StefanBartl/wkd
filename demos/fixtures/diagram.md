# Request pipeline

How a request travels through the service:

```ascii
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client  │ ──→ │  Router  │ ──→ │  Handler │
└──────────┘     └──────────┘     └──────────┘
      ↓                ↓                ↓
   ★ TLS           ● auth           ✓ 200 OK
```

The handler keeps one counter per connection:

```ascii
┌───────────────────────┐
│ function counter()    │
│   local count = 0     │
│   return function()   │
│     count = count + 1 │
│     return count      │
│   end                 │
│ end                   │
└───────────────────────┘
```
