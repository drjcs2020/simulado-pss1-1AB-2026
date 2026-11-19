// Recortes apenas da área OMR de dois cartões reais do projeto; sem nome, QR ou identificação.
// Máscaras binárias 480x210 compactadas em zlib+Base64. 255=preenchimento/borda.
export const realCardCrops = [
  {
    "title": "cartão oficial preenchido (conferência)",
    "width": 480,
    "height": 210,
    "expected": [
      15,
      13,
      8,
      0,
      5,
      6,
      7,
      12,
      13,
      15
    ],
    "compressed": "eNrtneF62yAMRfX+L333rU23OjZYMsgGcu6fbamnAicySFjYDN0oLfVrEHzhC99P46uX/l6vn4++/i7BdwH/lb6BwnfR+/OPA/9jCl/mX/jCF8EXzcxXaH7hSQghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQmU+CZ+YxLMatXgejDpQsKVLcGCnFyzCrPbE7HImbhC1/4whe+S/L9Xhm42vt1hMT+2sOuBc2a3+xRCxpbq7LZQsfUNl4RDB381Avi6yNf1wrjc3Dt62gZt1kn358FrbtjPr6v8XKblbn5FsfxVr5uEN5rVR6Gklk/XwvwtRS+WpXvod0i3yazN/ONmH3af0tmVGyHb6I8vpVXliEtZtvXV26+YbPeD4vjxfqZ9TN84Qtf+MIXvmdri6SvjcEXvvCFL3zhC1/4whe+iXy3D/jsnvf53d7tD72XavdLupi1gtn2ju3MSlnjFTF73UH3/yq0d/On3g0cdc02meIqXwvwLXXhAISrY5sW7Ixt+fYcr4hZ+MK3MGEo0F79aq+m4is/X1X57ueZq+MVwdCygJKXr97aqzX9961jyhqviNle/qsc/1UOX63qv2L+Zf6FL3yJf5eOf8lfkZ+EL3zhC1/4whe+fflmxUfbQL0aHx2Z1ZnZ8/go0LG6WXUx+2x8FA8TXXztKt9Ts135WoBvz/GKmIUvfD18txWo9fbKz3f7bPL76GrDt2p2D6HM97AVZy3Y/ecTvg3jFcHQzX9z+FoOX1uVr8EXvsy/zL/w/QS+7B+xf0T+ivwkfOELX/jCF77wvbya1nl7vZeerp8vt6C+fu5nVsoar4jZXu5ajueOv1IuvrX495rZ0/j3csfq8e91vtX497y18IVvZ77K4asIX7n5ys9XjqzZBb6V+hT8F//ttFyW33/l51ve/71m9tfYe/1Xfv9Vjv/K77+99n/xX+Zf+C7Dl/h36fiX/BX5SfjCF77whS984btofORb6D4fH7WN19DxbyQ+Wjb+bRsv+MK3O1/l8NWS+0d+s1G+WpavKYWv+fcXKvUpXcfrEb7cn80C/sv8y/wLX/jew5f9I/aPyF+Rn4QvfOELX/jCF76sn1k/h+M5Z6BK/Fvu2ND5DfjOyVc5fKfaX4jkn5XDV8/zjdSnWE59ij1cnxKs59FUfPHf6HiNwJf5l/UVfCflS/zL/hH5K/KT8IUvfOEL35T1lae9Oesra2iBY311qWPKGi9r71h2fCTqjxaNjwaIfwP+OxfftP1B+ML3/08i519Zwv5CiK9y6lNazgsbnW/EfzPqy2J8c/xXfv8V9+dR7s/i/sz8C1/4jsnXA4L9o/T9I/KT5CfhC1/4whe+8IUv9Uesn5+Mj9riuYGfnwzwHSD+PTALX/h25jvC+49S+CrAN2V/YRS+WpWvcvgO8H6ryH5mwH+lFL7u9x+Nwdfvv7z/iPkXvvAl/v2k+Jf8FflJ+MIXvvCF7/18eT7HqD+KXUr9EfHvDfFv5GsT8F/4DpJ/DtQvxPhqMr4t9TSd8s+B86/c+edA/VGQb875Znn557nONwvcn3P4znY+YeR+k1M/GOGrqfjKz1esr1hfwRe+5Dc+KL9BfnLt/CR84Qtf+MIXvvC9ny/PXxn1Rxfi3wDf5+PfXQvIb8B3Gr4p+0chvin1C6HzzRQ5v86s//l1Y+wf+euP8vxXGf6rnPPNQvVHmql+MM1/A/fniP+aUT/I/Mv6ynj/0Vh8iX+pPyJ/RX4SvvCFL3zhm7K+6rgQ4vmcktkYhofiI+qPGsaL+Jf4F77wTeI70/l15J+v8NWqfNc9vy60P2gZ9WUhvlrVfzm/jvkXvvDtGa+T36D+iPzkg/lJ+MIXvvCFL3zhC1/4whe+tXjwTDmXYvY7uo1cixBCCCGEEEIIIYQQQgPoD864SLI="
  },
  {
    "title": "cartão oficial alternativo preenchido",
    "width": 480,
    "height": 210,
    "expected": [
      11,
      4,
      15,
      3,
      0,
      8,
      7,
      12,
      13,
      15
    ],
    "compressed": "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"
  }
] as const;
