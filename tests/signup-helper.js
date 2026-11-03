// Signs a player up the way the browser does: ask for a code, then register with it.
// Tests run without an SMS or email provider, so the server returns the code as devOtp.
export async function signUp(request, { channel = 'email', email = '', phone = '', displayName, password }) {
  const sent = await request('/api/auth/otp/send', { body: { channel, email, phone, displayName } })
  if (sent.status !== 200) return sent
  return request('/api/users/register', { body: { channel, email, phone, displayName, password, otpToken: sent.data.otpToken, otp: sent.data.devOtp } })
}
