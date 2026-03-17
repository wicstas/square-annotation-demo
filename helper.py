# read text file like: "1, 2, 3, 255"
with open("public/sobol.txt", "r") as f:
    text = f.read()

# parse into integers
numbers = [int(x.strip()) for x in text.split(",") if x.strip()]

# convert to bytes (uint8)
data = bytes(numbers)

# write raw binary
with open("output.bin", "wb") as f:
    f.write(data)