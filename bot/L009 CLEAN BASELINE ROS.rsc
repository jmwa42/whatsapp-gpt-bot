# =========================
# L009 CLEAN BASELINE (ROS v7)
# Starlink (WAN), CRS125 trunk, VLANs, Safe mgmt port, WG VPN
# =========================

/system identity set name="L009-Edge"

# -------------------------
# 0) Interface lists
# -------------------------
/interface list
add name=WAN comment="Internet-facing"
add name=LAN comment="Trusted mgmt & internal"

/interface list member
add interface=ether1 list=WAN   ; Starlink WAN (bypass mode DHCP)
add interface=ether8 list=LAN   ; Lifeboat mgmt port

# -------------------------
# 1) Lifeboat management on ether8 (avoid lockout)
#    Plug a laptop to ether8 and browse http://192.168.88.1
# -------------------------
/ip address
add address=192.168.88.1/24 interface=ether8 comment="Mgmt lifeboat"

/ip pool
add name=pool-mgmt ranges=192.168.88.100-192.168.88.200

/ip dhcp-server
add name=dhcp-mgmt interface=ether8 address-pool=pool-mgmt lease-time=1h disabled=no

/ip dhcp-server network
add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=1.1.1.1,9.9.9.9

# Optional: allow router to resolve for clients (LAN only, WAN blocked by firewall)
/ip dns set allow-remote-requests=yes servers=1.1.1.1,9.9.9.9

# Tighten L2 mgmt exposure to LAN only
/tool mac-server set allowed-interface-list=LAN
/tool mac-server mac-winbox set allowed-interface-list=LAN
/ip neighbor discovery-settings set discover-interface-list=LAN

# -------------------------
# 2) WAN via Starlink on ether1 (Priority -> public IP by DHCP)
# -------------------------
/ip dhcp-client
add interface=ether1 use-peer-dns=yes add-default-route=yes disabled=no comment="Starlink DHCP"

# -------------------------
# 3) VLAN-aware bridge for CRS125 trunk on ether2
# -------------------------
/interface bridge
add name=br-vlan vlan-filtering=no comment="VLAN-aware bridge for LAN trunk"

/interface bridge port
# Trunk to CRS125: tagged only
add bridge=br-vlan interface=ether2 frame-types=admit-only-vlan-tagged ingress-filtering=yes

# Add bridge itself to LAN list (router SVIs live here)
/interface list member
add interface=br-vlan list=LAN

# -------------------------
# 4) VLAN SVI interfaces (router gateways)
# -------------------------
/interface vlan
add name=vlan10-CCTV  interface=br-vlan vlan-id=10
add name=vlan20-VoIP  interface=br-vlan vlan-id=20
add name=vlan30-Office interface=br-vlan vlan-id=30
add name=vlan40-Guest interface=br-vlan vlan-id=40
add name=vlan50-Staff interface=br-vlan vlan-id=50

/ip address
add address=192.168.10.1/24 interface=vlan10-CCTV  comment="CCTV GW"
add address=192.168.20.1/24 interface=vlan20-VoIP  comment="VoIP GW"
add address=192.168.30.1/24 interface=vlan30-Office comment="Office/AP Mgmt GW"
add address=192.168.40.1/24 interface=vlan40-Guest  comment="Guest GW"
add address=192.168.50.1/24 interface=vlan50-Staff  comment="Staff GW"

# -------------------------
# 5) DHCP per VLAN
# -------------------------
/ip pool
add name=pool10 ranges=192.168.10.100-192.168.10.200
add name=pool20 ranges=192.168.20.100-192.168.20.200
add name=pool30 ranges=192.168.30.100-192.168.30.200
add name=pool40 ranges=192.168.40.100-192.168.40.200
add name=pool50 ranges=192.168.50.100-192.168.50.200

/ip dhcp-server
add name=dhcp10 interface=vlan10-CCTV address-pool=pool10 disabled=no
add name=dhcp20 interface=vlan20-VoIP address-pool=pool20 disabled=no
add name=dhcp30 interface=vlan30-Office address-pool=pool30 disabled=no
add name=dhcp40 interface=vlan40-Guest address-pool=pool40 disabled=no
add name=dhcp50 interface=vlan50-Staff address-pool=pool50 disabled=no

/ip dhcp-server network
add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=1.1.1.1,9.9.9.9 comment="CCTV"
add address=192.168.20.0/24 gateway=192.168.20.1 dns-server=1.1.1.1,9.9.9.9 comment="VoIP"
add address=192.168.30.0/24 gateway=192.168.30.1 dns-server=1.1.1.1,9.9.9.9 comment="Office/AP Mgmt"
add address=192.168.40.0/24 gateway=192.168.40.1 dns-server=1.1.1.1,9.9.9.9 comment="Guest"
add address=192.168.50.0/24 gateway=192.168.50.1 dns-server=1.1.1.1,9.9.9.9 comment="Staff"

# -------------------------
# 6) Bridge VLAN table (tag router + trunk)
# -------------------------
/interface bridge vlan
add bridge=br-vlan tagged=br-vlan,ether2 vlan-ids=10
add bridge=br-vlan tagged=br-vlan,ether2 vlan-ids=20
add bridge=br-vlan tagged=br-vlan,ether2 vlan-ids=30
add bridge=br-vlan tagged=br-vlan,ether2 vlan-ids=40
add bridge=br-vlan tagged=br-vlan,ether2 vlan-ids=50

# Now enable filtering
/interface bridge set br-vlan vlan-filtering=yes

# -------------------------
# 7) Secure services (defense in depth)
#    Only reachable from Mgmt (192.168.88.0/24), Office (192.168.30.0/24) & VPN (10.100.0.0/24)
/ip service
set telnet disabled=yes
set ftp disabled=yes
set www address=192.168.88.0/24,192.168.30.0/24,10.100.0.0/24
set www-ssl disabled=yes
set ssh address=192.168.88.0/24,192.168.30.0/24,10.100.0.0/24
set winbox address=192.168.88.0/24,192.168.30.0/24,10.100.0.0/24
set api disabled=yes
set api-ssl disabled=yes

# -------------------------
# 8) Firewall + NAT (hardened baseline)
# -------------------------
/ip firewall nat
add chain=srcnat out-interface-list=WAN action=masquerade comment="NAT all VLANs & VPN -> WAN"

# FastTrack for performance
/ip firewall filter
add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes comment="FastTrack"
add chain=forward action=accept connection-state=established,related comment="Allow established/related"

# Drop invalid early
add chain=input action=drop connection-state=invalid comment="Drop invalid input"
add chain=forward action=drop connection-state=invalid comment="Drop invalid forward"

# Allow essential WAN input BEFORE general WAN drop
add chain=input action=accept in-interface-list=WAN protocol=icmp comment="Allow ICMP from WAN (PMTU)"
add chain=input action=accept in-interface-list=WAN protocol=udp dst-port=68 src-port=67 comment="Allow DHCP client on WAN"
add chain=input action=accept in-interface-list=WAN protocol=udp dst-port=51820 comment="Allow WireGuard"

# Allow management to router (but NOT from Guest/CCTV/VoIP)
add chain=input action=accept in-interface=ether8 comment="Mgmt port to router"
add chain=input action=accept in-interface=vlan30-Office comment="Office to router"
add chain=input action=accept in-interface=vlan50-Staff comment="Staff to router"

# Drop ALL other WAN-to-router
add chain=input action=drop in-interface-list=WAN comment="DROP all other WAN input"

# LAN/VPN to Internet & inter-VLAN (policy below further restricts Guest)
add chain=forward action=accept in-interface-list=LAN out-interface-list=WAN comment="LAN->WAN"
add chain=forward action=accept in-interface=wg0 out-interface-list=LAN comment="VPN->LAN allowed"
add chain=forward action=accept in-interface=wg0 out-interface-list=WAN comment="VPN->Internet allowed"

# Guest isolation (block Guest to all other VLANs)
add chain=forward action=drop src-address=192.168.40.0/24 dst-address=192.168.10.0/24 comment="Guest -> CCTV DROP"
add chain=forward action=drop src-address=192.168.40.0/24 dst-address=192.168.20.0/24 comment="Guest -> VoIP DROP"
add chain=forward action=drop src-address=192.168.40.0/24 dst-address=192.168.30.0/24 comment="Guest -> Office DROP"
add chain=forward action=drop src-address=192.168.40.0/24 dst-address=192.168.50.0/24 comment="Guest -> Staff DROP"

# Optional: allow Staff to reach CCTV (comment out if not needed)
add chain=forward action=accept src-address=192.168.50.0/24 dst-address=192.168.10.0/24 comment="Staff -> CCTV ALLOW"

# Bogon/private spoofing on WAN
add chain=input action=drop in-interface-list=WAN src-address=10.0.0.0/8 comment="Drop spoofed 10/8 from WAN"
add chain=input action=drop in-interface-list=WAN src-address=172.16.0.0/12
add chain=input action=drop in-interface-list=WAN src-address=192.168.0.0/16

# -------------------------
# 9) WireGuard VPN (server side)
#    Generate router key: /interface wireguard key generate
# -------------------------
/interface wireguard
add name=wg0 listen-port=51820 private-key="REPLACE_WITH_ROUTER_PRIVATE_KEY"

/ip address
add address=10.100.0.1/24 interface=wg0 comment="WG VPN subnet"

/interface wireguard peers
# Example peer (add your phone/laptop public key here); duplicate line per peer
# Assign each peer a unique /32 in 10.100.0.0/24
# add interface=wg0 public-key="REPLACE_WITH_CLIENT_PUBLIC_KEY" allowed-address=10.100.0.2/32 comment="Joseph-Phone"

# -------------------------
# 10) (Optional) minimal IPv6 hardening (Starlink often gives IPv6)
# -------------------------
/ipv6 settings set disable-ipv6=yes
# (Enable and add firewall later if you want IPv6; this keeps things simple & safe.)

# -------------------------
# 11) Housekeeping
# -------------------------
/system note set show-at-login=yes note="Mgmt: plug into ether8 -> 192.168.88.1. Trunk to CRS125 on ether2. WAN on ether1."
/system clock print

