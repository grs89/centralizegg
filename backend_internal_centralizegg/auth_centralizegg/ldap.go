package auth_centralizegg

import (
	"crypto/tls"
	"fmt"
	"strings"

	"github.com/go-ldap/ldap/v3"
	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
)

// AuthenticateLDAP attempts to authenticate a user against an LDAP/Active Directory server.
func AuthenticateLDAP(username, password string, config *data_centralizegg.LDAPConfig) (bool, error) {
	if !config.Enabled {
		return false, fmt.Errorf("LDAP authentication is disabled")
	}

	address := fmt.Sprintf("%s:%d", config.ServerAddress, config.Port)

	var l *ldap.Conn
	var err error

	// Establish connection based on port (389 standard, 636 LDAPS)
	if config.Port == 636 {
		l, err = ldap.DialTLS("tcp", address, &tls.Config{InsecureSkipVerify: true})
	} else {
		l, err = ldap.DialURL(fmt.Sprintf("ldap://%s", address))
	}

	if err != nil {
		return false, fmt.Errorf("LDAP Dial error: %w", err)
	}
	defer l.Close()

	// 1. Bind with the service account (BindDN/BindPassword)
	err = l.Bind(config.BindDN, config.BindPassword)
	if err != nil {
		return false, fmt.Errorf("LDAP Bind error (service account): %w", err)
	}

	// 2. Search for the user to get their actual DN
	// E.g. "(sAMAccountName=%s)" or "(uid=%s)"
	filter := strings.ReplaceAll(config.UserFilter, "%s", ldap.EscapeFilter(username))
	searchRequest := ldap.NewSearchRequest(
		config.BaseDN,
		ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 0, false,
		filter,
		[]string{"dn"}, // We only need the DN to bind as the user
		nil,
	)

	sr, err := l.Search(searchRequest)
	if err != nil {
		return false, fmt.Errorf("LDAP Search error: %w", err)
	}

	if len(sr.Entries) == 0 {
		return false, fmt.Errorf("user not found in LDAP")
	}
	if len(sr.Entries) > 1 {
		return false, fmt.Errorf("multiple users found in LDAP with the same criteria")
	}

	userDN := sr.Entries[0].DN

	// 3. Bind with the user's actual DN and password to verify credentials
	err = l.Bind(userDN, password)
	if err != nil {
		// If binding fails here, the password is wrong
		return false, nil
	}

	// If we reach here, authentication is successful
	return true, nil
}
