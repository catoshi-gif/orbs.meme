import Image from "next/image";

const socials = [
  {
    href: "https://x.com/orbsdotmeme",
    label: "X",
    icon: "/social-x.png",
  },
  {
    href: "https://discord.gg/32yWCvqnh",
    label: "Discord",
    icon: "/social-discord.png",
  },
] as const;

export default function SocialLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "social-links social-links-compact" : "social-links"}>
      {socials.map((social) => (
        <a
          key={social.href}
          className="social-link"
          href={social.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Orbs.meme on ${social.label}`}
          title={social.label}
        >
          <Image src={social.icon} width={24} height={24} alt="" aria-hidden="true" />
          {!compact ? <span>{social.label}</span> : null}
        </a>
      ))}
    </div>
  );
}
