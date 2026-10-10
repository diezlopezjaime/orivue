use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use url::Url;

use crate::{ProxyError, Result};

/// Which destinations a session may contact.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DestinationPolicy {
    /// Public addresses only.
    PublicOnly,
    /// Public addresses plus loopback (local engines such as Ace Stream).
    AllowLoopback,
    /// Anything, including LAN addresses (explicit user setting).
    AllowPrivate,
}

fn is_private_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 0
        || a == 10
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 100 && (64..=127).contains(&b))
        || a >= 224
}

fn is_private_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_private_v4(v4);
    }
    let segments = ip.segments();
    ip.is_loopback()
        || ip.is_unspecified()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] & 0xff00) == 0xff00
}

pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_v4(v4),
        IpAddr::V6(v6) => is_private_v6(v6),
    }
}

pub fn is_loopback_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => {
            v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
        }
    }
}

fn is_allowed(ip: IpAddr, policy: DestinationPolicy) -> bool {
    match policy {
        DestinationPolicy::AllowPrivate => true,
        DestinationPolicy::AllowLoopback => is_loopback_ip(ip) || !is_private_ip(ip),
        DestinationPolicy::PublicOnly => !is_private_ip(ip),
    }
}

/// Parses and validates a destination URL: scheme, host and every resolved address.
pub async fn validate_destination(raw: &str, policy: DestinationPolicy) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| ProxyError::InvalidUrl)?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(ProxyError::UnsupportedScheme);
    }
    let host = url.host_str().ok_or(ProxyError::InvalidUrl)?;
    let port = url.port_or_known_default().unwrap_or(80);
    let addresses: Vec<SocketAddr> = match url.host() {
        Some(url::Host::Ipv4(ip)) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Some(url::Host::Ipv6(ip)) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        _ => {
            let lookup = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                tokio::net::lookup_host((host, port)),
            )
            .await
            .map_err(|_| ProxyError::UnresolvedHost)?
            .map_err(|_| ProxyError::UnresolvedHost)?;
            lookup.collect()
        }
    };
    if addresses.is_empty() {
        return Err(ProxyError::UnresolvedHost);
    }
    if addresses
        .iter()
        .any(|address| !is_allowed(address.ip(), policy))
    {
        return Err(ProxyError::PrivateDestination);
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_addresses() {
        assert!(is_private_ip("127.0.0.1".parse().unwrap()));
        assert!(is_private_ip("10.1.2.3".parse().unwrap()));
        assert!(is_private_ip("172.20.0.1".parse().unwrap()));
        assert!(is_private_ip("192.168.1.1".parse().unwrap()));
        assert!(is_private_ip("169.254.169.254".parse().unwrap()));
        assert!(is_private_ip("::1".parse().unwrap()));
        assert!(is_private_ip("fd00::1".parse().unwrap()));
        assert!(is_private_ip("::ffff:10.0.0.1".parse().unwrap()));
        assert!(!is_private_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_private_ip("2606:4700::1111".parse().unwrap()));
        assert!(is_loopback_ip("::ffff:127.0.0.1".parse().unwrap()));
    }

    #[tokio::test]
    async fn applies_policies() {
        assert!(matches!(
            validate_destination("http://127.0.0.1:1/x", DestinationPolicy::PublicOnly).await,
            Err(ProxyError::PrivateDestination)
        ));
        assert!(
            validate_destination("http://127.0.0.1:1/x", DestinationPolicy::AllowLoopback)
                .await
                .is_ok()
        );
        assert!(matches!(
            validate_destination("http://10.0.0.1/x", DestinationPolicy::AllowLoopback).await,
            Err(ProxyError::PrivateDestination)
        ));
        assert!(
            validate_destination("http://10.0.0.1/x", DestinationPolicy::AllowPrivate)
                .await
                .is_ok()
        );
        assert!(matches!(
            validate_destination("ftp://example.com/x", DestinationPolicy::AllowPrivate).await,
            Err(ProxyError::UnsupportedScheme)
        ));
        assert!(matches!(
            validate_destination("nope", DestinationPolicy::AllowPrivate).await,
            Err(ProxyError::InvalidUrl)
        ));
    }
}
