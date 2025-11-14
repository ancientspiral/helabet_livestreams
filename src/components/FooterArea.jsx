import { useState, useMemo } from "react";
import { FiChevronDown, FiFacebook, FiInstagram, FiTwitter } from "react-icons/fi";
import { FaTiktok } from "react-icons/fa";

const accordionColumns = [
  {
    title: "MAIN",
    links: [
      "Sports",
      "Live",
      "Slots",
      "Games",
      "Live Casino",
      "Results",
      "Registration",
      "Bingo",
      "TV Games",
      "Virtual sports",
      "First Deposit Bonus",
    ],
  },
  {
    title: "LIVE",
    links: ["Football", "Tennis", "Basketball", "Ice Hockey", "Volleyball"],
  },
  {
    title: "LINE",
    links: [
      "Football",
      "Tennis",
      "Basketball",
      "Ice Hockey",
      "Volleyball",
    ],
  },
];

const footerColumns = [
  {
    title: "INFORMATION",
    links: [
      "About us",
      "Terms and Conditions",
      "Responsible Gambling",
      "Affiliate Program",
      "Privacy Policy",
      "Cookie Policy",
      "Contacts",
      "Anti-Money Laundering",
      "KYC Policies",
      "Self-exclusion",
      "Dispute resolution",
      "Fairness & RNG Testing Methods",
      "Accounts, Payouts & Bonuses",
    ],
  },
  {
    title: "BETTING",
    links: ["Sports", "Live"],
  },
  {
    title: "GAMES",
    links: ["Slots", "Games", "Live Casino"],
  },
  {
    title: "STATISTICS",
    links: ["Statistics", "Results"],
  },
  {
    title: "USEFUL LINKS",
    links: ["Payment methods", "Mobile version", "Registration", "How to place a bet"],
  },
  {
    title: "APPS",
    links: ["Android"],
  },
];

const FooterArea = () => {
  const [isOpen, setIsOpen] = useState(true);
  const accordionId = useMemo(() => "footer-accordion-content", []);

  return (
    <footer className="footer-area">
      <div className="container footer-container">
        <div className="footer-topline">ONLINE SPORTS BETTING PLATFORM &amp; CASINO: HELABET</div>

        <div className="footer-accordion-block">
          <button
            type="button"
            className={`footer-accordion-toggle${isOpen ? " is-open" : ""}`}
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-controls={accordionId}
          >
            <span className="footer-accordion-heading">POPULAR EVENTS AND SPORTS NEWS</span>
            <FiChevronDown aria-hidden="true" className="footer-accordion-icon" />
          </button>

          {isOpen && (
            <div className="footer-accordion__content" id={accordionId}>
              {accordionColumns.map((column) => (
                <div key={column.title} className="footer-accordion-column">
                  <span className="footer-accordion-title">{column.title}</span>
                  {column.links.map((link) => (
                    <a key={link} href="#">
                      {link}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="footer-bottom">
          <div className="footer-links">
            {footerColumns.map((column) => (
              <div key={column.title} className="footer-column">
                <span className="footer-column-title">{column.title}</span>
                {column.links.map((link) => (
                  <a key={link} href="#">
                    {link}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="footer-legal">
          <div className="footer-legal-text">
            <p>
              Copyright © 2019 - 2025 «Helabet».<br />
              Helabet uses cookies to ensure the best user experience. By remaining on the website,
              you consent to the use of your cookie files on Helabet. Find out more.
            </p>
          </div>
          <div className="footer-legal-actions">
            <div className="footer-social">
              <a href="#" aria-label="Visit Helabet on X">
                <FiTwitter aria-hidden="true" />
              </a>
              <a href="#" aria-label="Visit Helabet on TikTok">
                <FaTiktok aria-hidden="true" />
              </a>
              <a href="#" aria-label="Visit Helabet on Instagram">
                <FiInstagram aria-hidden="true" />
              </a>
              <a href="#" aria-label="Visit Helabet on Facebook">
                <FiFacebook aria-hidden="true" />
              </a>
            </div>
            <span className="footer-legal-age">18+</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default FooterArea;
