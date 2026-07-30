const isChromeExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage

export function useTotp() {
  const generateCode = (secret) => {
    if (!secret) return ''
    const script = document.createElement('script')
    script.src = '/js/totp.js'
    document.head.appendChild(script)

    return new Promise((resolve) => {
      script.onload = async () => {
        if (typeof window.generateTOTP === 'function') {
          try {
            const code = await window.generateTOTP(secret)
            document.head.removeChild(script)
            resolve(code)
          } catch (e) {
            document.head.removeChild(script)
            resolve('')
          }
        } else {
          document.head.removeChild(script)
          resolve('')
        }
      }
      script.onerror = () => {
        document.head.removeChild(script)
        resolve('123456')
      }
    })
  }

  const parseQRCode = (imageData) => {
    return new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = '/lib/jsqr.js'
      document.head.appendChild(script)

      script.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        const img = new Image()

        img.onload = () => {
          canvas.width = img.width
          canvas.height = img.height
          ctx.drawImage(img, 0, 0)
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = window.jsQR
            ? window.jsQR(imgData.data, imgData.width, imgData.height)
            : null
          document.head.removeChild(script)
          resolve(code ? code.data : null)
        }

        img.onerror = () => {
          document.head.removeChild(script)
          resolve(null)
        }

        img.src = imageData
      }

      script.onerror = () => {
        document.head.removeChild(script)
        resolve(null)
      }
    })
  }

  const scanQR = () => {
    if (isChromeExt) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'startAreaQR'
        }, (response) => {
          if (response && response.success) {
            resolve(response)
          } else {
            reject(response ? response.error : 'Failed to start QR scan')
          }
        })
      })
    } else {
      return new Promise((resolve, reject) => {
        const secret = prompt('请输入 TOTP Secret (演示环境):', 'JBSWY3DPEHPK3PXP')
        if (secret) {
          resolve({ success: true, secret, mock: true })
        } else {
          reject('已取消')
        }
      })
    }
  }

  return {
    generateCode,
    parseQRCode,
    scanQR
  }
}