import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';

/*
 * React port of about.html — a fully static content page, so this is a direct
 * markup translation with the same classes the shared stylesheet expects.
 */
export default function About() {
  return (
    <>
      <Nav active="About" />

      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">About Us</div>
          <h1 className="section-title reveal reveal-delay-1">Connecting <em>campuses</em><br />through events</h1>
          <p className="section-sub reveal reveal-delay-2">
            Unisocials is the event ticket selling platform built for university communities across Nigeria.
          </p>
        </div>
      </section>

      <section className="content-section">
        <div className="container">
          <div className="content-grid">
            <div className="content-text reveal">
              <h2>Our <em>mission</em></h2>
              <p>
                Unisocials was created to solve a simple problem: students and faculty members struggled to discover,
                promote, and attend campus events. Tickets were sold manually, information was scattered across WhatsApp
                groups, and many great events went unnoticed.
              </p>
              <p>
                We built Unisocials as a centralized platform where any faculty association, student organization, or
                department can list events, sell tickets, and reach the entire campus community.
              </p>
              <p>
                Today, we serve thousands of students across 6 faculties, processing hundreds of ticket transactions
                every month.
              </p>
            </div>
            <div className="content-visual reveal reveal-delay-1">
              <div className="content-visual-icon">🎓</div>
              <h3>Proudly For Students</h3>
              <p>Built by students, for students. We power campus events and take care of every community.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="stats-section">
        <div className="container">
          <div className="stats-grid">
            <div className="stat-card reveal">
              <div className="stat-value">2024</div>
              <div className="stat-label">Founded</div>
            </div>
            <div className="stat-card reveal reveal-delay-1">
              <div className="stat-value">6</div>
              <div className="stat-label">Faculties Served</div>
            </div>
            <div className="stat-card reveal reveal-delay-2">
              <div className="stat-value">1,200+</div>
              <div className="stat-label">Tickets Sold</div>
            </div>
            <div className="stat-card reveal reveal-delay-3">
              <div className="stat-value">100%</div>
              <div className="stat-label">Student-Run</div>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container">
          <div className="cta-inner reveal">
            <div className="cta-content">
              <h2 className="cta-title">Want to partner with us?<br /><em>Let&apos;s talk.</em></h2>
              <p className="cta-sub">
                Faculty associations, departments, and student organizations — reach out to start selling tickets on Unisocials.
              </p>
            </div>
            <div className="cta-actions">
              <a href="/contact.html" className="btn-cta-primary">Contact Us <span>→</span></a>
              <a href="/events.html" className="btn-cta-ghost">Browse Events</a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
