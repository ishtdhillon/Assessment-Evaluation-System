const nodemailer = require('nodemailer');
require('dotenv').config();

// Gmail SMTP (easier than AWS SES for beginners)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendOtpEmail(toEmail, otp, facultyName) {
  await transporter.sendMail({
    from: `"CSE Result Portal" <${process.env.FROM_EMAIL}>`,
    to: toEmail,
    subject: 'Your OTP - CSE Result Portal',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#1a56db;">CSE Result Portal</h2>
        <p>Hello <strong>${facultyName || 'Faculty'}</strong>,</p>
        <p>Your One-Time Password (OTP) for login is:</p>
        <div style="font-size:40px;font-weight:bold;letter-spacing:12px;
                    background:#f3f4f6;padding:24px;text-align:center;
                    border-radius:8px;margin:20px 0;">
          ${otp}
        </div>
        <p>This OTP is valid for <strong>5 minutes</strong>.</p>
        <p style="color:#6b7280;font-size:13px;">
          Akal University — Department of CSE
        </p>
      </div>
    `
  });
}

module.exports = { sendOtpEmail };
