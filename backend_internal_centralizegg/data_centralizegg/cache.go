package data_centralizegg

import (
	"sync"
	"time"
)

type cacheItem struct {
	value      interface{}
	expiration int64
}

// TTLCache error-proof concurrent cache with Time-To-Live support
type TTLCache struct {
	items sync.Map
}

// NewTTLCache instantiates a new thread-safe TTL cache
func NewTTLCache() *TTLCache {
	cache := &TTLCache{}

	// Optional: Background ticker to clean up expired items to avoid memory leaks
	// In our case the number of keys is very small and known, so lazy eviction on Get is enough.

	return cache
}

// Set adds or updates a key with a value and a given TTL duration
func (c *TTLCache) Set(key string, value interface{}, ttl time.Duration) {
	expiration := time.Now().Add(ttl).UnixNano()
	c.items.Store(key, cacheItem{
		value:      value,
		expiration: expiration,
	})
}

// Get retrieves a key from cache. Returns value and true if present and valid.
// Returns nil and false if expired or missing. Evaluates lazily.
func (c *TTLCache) Get(key string) (interface{}, bool) {
	itemIntf, found := c.items.Load(key)
	if !found {
		return nil, false
	}

	item := itemIntf.(cacheItem)
	if time.Now().UnixNano() > item.expiration {
		// Lazy eviction
		c.items.Delete(key)
		return nil, false
	}

	return item.value, true
}
