package audit

import "net"

// splitHostPort is net.SplitHostPort with a string error suitable
// for the audit logger. Kept as a wrapper so the audit package does
// not need to import net/http just for the constant.
func splitHostPort(addr string) (string, string, error) {
	return net.SplitHostPort(addr)
}
