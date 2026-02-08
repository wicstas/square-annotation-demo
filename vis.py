import numpy as np
import matplotlib.pyplot as plt

def B(i, k, x, t):
    if(k == 1):
        return 1 if t[i]<=x and x<t[i+1] else 0
    else:
        return (x-t[i])/(t[i+k-1]-t[i])*B(i,k-1,x,t)+(t[i+k]-x)/(t[i+k]-t[i+1])*B(i+1,k-1,x,t)

def N(k, n, t):
    if k == 0:
        return 1 if 0 <= n and n <= 5 else 0
    return N(k - 1, n - 1, t / 2 + 0.5) * (1 - t) + N(k - 1, n, t / 2) * t

x = np.linspace(0, 10, 100)
# knobs = np.linspace(0, 1, 20)
# def fn(n):
#     return np.sum([np.vectorize(lambda x: B(i, n, x, knobs))(x) for i in range(9)], axis=0)
# plt.plot(x, fn(1), label='1')
# plt.plot(x, fn(2), label='2')
# plt.plot(x, fn(3), label='3')
# plt.plot(x, fn(4), label='4')
# plt.plot(x, fn(5), label='5')

plt.plot(x, np.vectorize(lambda t: N(1, int(t), t % 1))(x), label='N')

plt.legend()
plt.show()