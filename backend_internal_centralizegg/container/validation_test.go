package container

import (
	"strings"
	"testing"
)

func TestIsValidResourceName(t *testing.T) {
	// Generate boundary strings
	exactLimitStr := strings.Repeat("a", 253)
	overLimitStr := strings.Repeat("a", 254)

	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		// Valid cases
		{"valid basic", "my-container-123", true},
		{"valid with underscore", "my_container_123", true},
		{"valid with dot", "my.container.123", true},
		{"valid simple alphanumeric", "mycontainer", true},
		{"valid exact length limit", exactLimitStr, true},

		// Invalid cases - command injection attempts
		{"invalid command injection semicolon", "my-container; whoami", false},
		{"invalid command injection double-ampersand", "my-container && rm -rf /", false},
		{"invalid command injection pipe", "my-container | reboot", false},
		{"invalid command injection backticks", "my-container `id`", false},
		{"invalid command injection dollar", "my-container $(id)", false},

		// Invalid cases - shell and control characters
		{"invalid spaces", "my container", false},
		{"invalid single quotes", "'my-container'", false},
		{"invalid double quotes", "\"my-container\"", false},
		{"invalid backslash", "my\\container", false},
		{"invalid slash", "my/container", false},
		{"invalid asterisks", "my*container", false},
		{"invalid brackets", "my[container]", false},
		{"invalid curlies", "my{container}", false},
		{"invalid question mark", "my?container", false},

		// Invalid cases - boundaries
		{"invalid empty string", "", false},
		{"invalid over length limit", overLimitStr, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isValidResourceName(tt.input)
			if result != tt.expected {
				t.Errorf("isValidResourceName(%q) = %t; want %t", tt.input, result, tt.expected)
			}
		})
	}
}
